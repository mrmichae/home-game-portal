import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheckpointCompatibility } from "../domain/types.js";
import type { PortalDatabase } from "./database.js";
import { resolveLibraryPath } from "./path-security.js";

const MAX_RESTORABLE_GENERATIONS = 3;
const RESTORABLE_STATUSES = "'candidate', 'verified'";

export interface CheckpointContext {
  gameId: string;
  editionId: string;
  playerKey: string;
  romContentHash: string;
  compatibility: CheckpointCompatibility;
  lineageId?: string;
}

export interface StoredCheckpoint {
  id: string;
  lineageId: string;
  formatKey: string;
  generation: number;
  status: "candidate" | "verified";
  byteSize: number;
  stateSha256: string;
  capturedFrame: number;
  createdAt: string;
}

interface CheckpointRow {
  id: string;
  lineage_id: string;
  format_key: string;
  generation: number;
  status: "candidate" | "verified";
  relative_path: string;
  byte_size: number;
  state_sha256: string;
  captured_frame: number;
  created_at: string;
}

/**
 * Owns checkpoint identity, immutable generation files, promotion, rejection,
 * retention, and rollback selection. Callers never choose filesystem paths or
 * update checkpoint rows directly.
 */
export class VersionedCheckpointStore {
  private readonly pendingCaptures = new Map<string, Promise<void>>();

  constructor(
    private readonly savesRoot: string,
    private readonly database: PortalDatabase,
    private readonly maximumRestorableGenerations = MAX_RESTORABLE_GENERATIONS,
  ) {}

  capture(
    context: CheckpointContext,
    data: Buffer,
    capturedFrame: number,
    capturedAt = new Date(),
  ): Promise<StoredCheckpoint> {
    const queueKey = contextKey(context);
    const previous = this.pendingCaptures.get(queueKey) ?? Promise.resolve();
    const capture = previous
      .catch(() => undefined)
      .then(() => this.captureGeneration(context, data, capturedFrame, capturedAt));
    const tail = capture.then(() => undefined, () => undefined);
    this.pendingCaptures.set(queueKey, tail);
    return capture.finally(() => {
      if (this.pendingCaptures.get(queueKey) === tail) this.pendingCaptures.delete(queueKey);
    });
  }

  listRestorable(context: CheckpointContext): StoredCheckpoint[] {
    const lineageId = this.resolveActiveLineageId(context, false);
    if (!lineageId) return [];
    return this.database
      .prepare(
        `SELECT id, lineage_id, format_key, generation, status, relative_path, byte_size, state_sha256, captured_frame, created_at
         FROM save_checkpoints
         WHERE lineage_id = ? AND format_key = ?
           AND rom_content_hash = ? AND status IN (${RESTORABLE_STATUSES})
         ORDER BY generation DESC
         LIMIT ?`,
      )
      .all(
        lineageId,
        checkpointFormatKey(context.compatibility),
        context.romContentHash,
        this.maximumRestorableGenerations,
      )
      .map((row) => toStoredCheckpoint(row as unknown as CheckpointRow));
  }

  async readState(checkpointId: string, context: CheckpointContext): Promise<Buffer | null> {
    const row = this.findRestorable(checkpointId, context);
    return row ? this.readRow(row) : null;
  }

  async readStateForProfile(
    checkpointId: string,
    playerKey: string,
    compatibility: CheckpointCompatibility,
  ): Promise<Buffer | null> {
    const row = this.database.prepare(
      `SELECT checkpoint.id, checkpoint.lineage_id, checkpoint.format_key, checkpoint.generation,
              checkpoint.status, checkpoint.relative_path, checkpoint.byte_size,
              checkpoint.state_sha256, checkpoint.captured_frame, checkpoint.created_at
       FROM save_checkpoints AS checkpoint
       JOIN checkpoint_lineages AS lineage ON lineage.id = checkpoint.lineage_id
       WHERE checkpoint.id = ? AND checkpoint.player_key = ? AND checkpoint.format_key = ?
         AND checkpoint.status IN (${RESTORABLE_STATUSES}) AND lineage.state = 'active'`,
    ).get(checkpointId, playerKey, checkpointFormatKey(compatibility)) as unknown as CheckpointRow | undefined;
    return row ? this.readRow(row) : null;
  }

  private async readRow(row: CheckpointRow): Promise<Buffer | null> {
    let state: Buffer;
    try {
      state = await readFile(resolveLibraryPath(this.savesRoot, row.relative_path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const checksum = createHash("sha256").update(state).digest("hex");
    if (state.byteLength !== row.byte_size || checksum !== row.state_sha256) {
      throw new Error("Checkpoint data failed its integrity check.");
    }
    return state;
  }

  verify(checkpointId: string, context: CheckpointContext, observedFrame: number, verifiedAt = new Date()): StoredCheckpoint {
    if (!Number.isSafeInteger(observedFrame) || observedFrame < 0) throw new Error("Observed checkpoint frame is invalid.");
    const checkpoint = this.findRestorable(checkpointId, context);
    if (!checkpoint) throw new Error("Checkpoint is unavailable.");
    this.database.prepare(
      `UPDATE save_checkpoints
       SET status = 'verified', verified_at = ?, failed_at = NULL, failure_reason = NULL
       WHERE id = ?`,
    ).run(verifiedAt.toISOString(), checkpointId);
    return { ...toStoredCheckpoint(checkpoint), status: "verified" };
  }

  async reject(
    checkpointId: string,
    context: CheckpointContext,
    reason: string,
    rejectedAt = new Date(),
  ): Promise<boolean> {
    const checkpoint = this.findRestorable(checkpointId, context);
    if (!checkpoint) return false;
    const failureReason = reason.trim().slice(0, 240) || "Checkpoint could not be restored.";
    this.database.prepare(
      `UPDATE save_checkpoints
       SET status = 'failed', failed_at = ?, failure_reason = ?
       WHERE id = ?`,
    ).run(rejectedAt.toISOString(), failureReason, checkpointId);
    await removeFile(resolveLibraryPath(this.savesRoot, checkpoint.relative_path));
    return true;
  }

  async deleteGame(gameId: string, playerKey: string): Promise<boolean> {
    const rows = this.database.prepare(
      `SELECT save_checkpoints.relative_path
       FROM save_checkpoints
       JOIN editions ON editions.id = save_checkpoints.edition_id
       WHERE editions.game_id = ? AND save_checkpoints.player_key = ?
       UNION
       SELECT saves.relative_path
       FROM saves
       JOIN editions ON editions.id = saves.edition_id
       WHERE editions.game_id = ? AND saves.player_key = ?`,
    ).all(gameId, playerKey, gameId, playerKey) as unknown as Array<{ relative_path: string }>;

    await Promise.all(rows.map((row) => removeFile(resolveLibraryPath(this.savesRoot, row.relative_path))));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        `DELETE FROM save_checkpoints WHERE player_key = ?
         AND edition_id IN (SELECT id FROM editions WHERE game_id = ?)`,
      ).run(playerKey, gameId);
      this.database.prepare(
        `DELETE FROM checkpoint_lineages WHERE player_key = ?
         AND edition_id IN (SELECT id FROM editions WHERE game_id = ?)`,
      ).run(playerKey, gameId);
      this.database.prepare(
        `DELETE FROM saves WHERE player_key = ?
         AND edition_id IN (SELECT id FROM editions WHERE game_id = ?)`,
      ).run(playerKey, gameId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return rows.length > 0;
  }

  private async captureGeneration(
    context: CheckpointContext,
    data: Buffer,
    capturedFrame: number,
    capturedAt: Date,
  ): Promise<StoredCheckpoint> {
    if (data.byteLength === 0) throw new Error("Checkpoint is empty.");
    if (!Number.isSafeInteger(capturedFrame) || capturedFrame < 0) throw new Error("Captured checkpoint frame is invalid.");
    this.assertContext(context);
    const lineageId = this.resolveActiveLineageId(context, true)!;
    const formatKey = checkpointFormatKey(context.compatibility);

    const generationRow = this.database.prepare(
      `SELECT COALESCE(MAX(generation), 0) + 1 AS generation
       FROM save_checkpoints
       WHERE lineage_id = ? AND format_key = ?`,
    ).get(
      lineageId,
      formatKey,
    ) as unknown as { generation: number };
    const generation = generationRow.generation;
    const id = randomBytes(18).toString("base64url");
    const relativeDirectory = path.posix.join(context.playerKey, context.gameId, "checkpoints", lineageId);
    const relativePath = path.posix.join(relativeDirectory, `${String(generation).padStart(6, "0")}-${id}.state`);
    const directory = resolveLibraryPath(this.savesRoot, relativeDirectory);
    const destination = resolveLibraryPath(this.savesRoot, relativePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${destination}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, destination);

    try {
      this.database.prepare(
        `INSERT INTO save_checkpoints(
           id, lineage_id, edition_id, player_key, format_key, origin_adapter_key, origin_client_version,
           rom_content_hash, generation, status, relative_path, byte_size,
           state_sha256, captured_frame, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        lineageId,
        context.editionId,
        context.playerKey,
        formatKey,
        context.compatibility.adapterKey,
        context.compatibility.runtimeVersion,
        context.romContentHash,
        generation,
        relativePath,
        data.byteLength,
        createHash("sha256").update(data).digest("hex"),
        capturedFrame,
        capturedAt.toISOString(),
      );
    } catch (error) {
      await removeFile(destination);
      throw error;
    }

    await this.prune(context);
    return {
      id,
      lineageId,
      formatKey,
      generation,
      status: "candidate",
      byteSize: data.byteLength,
      stateSha256: createHash("sha256").update(data).digest("hex"),
      capturedFrame,
      createdAt: capturedAt.toISOString(),
    };
  }

  private findRestorable(checkpointId: string, context: CheckpointContext): CheckpointRow | null {
    const lineageId = this.resolveActiveLineageId(context, false);
    if (!lineageId) return null;
    const row = this.database.prepare(
      `SELECT id, lineage_id, format_key, generation, status, relative_path, byte_size, state_sha256, captured_frame, created_at
       FROM save_checkpoints
       WHERE id = ? AND lineage_id = ? AND format_key = ?
         AND rom_content_hash = ? AND status IN (${RESTORABLE_STATUSES})`,
    ).get(
      checkpointId,
      lineageId,
      checkpointFormatKey(context.compatibility),
      context.romContentHash,
    ) as unknown as CheckpointRow | undefined;
    return row ?? null;
  }

  private assertContext(context: CheckpointContext): void {
    const source = this.database.prepare(
      `SELECT 1
       FROM editions
       JOIN game_files ON game_files.edition_id = editions.id
       WHERE editions.id = ? AND editions.game_id = ?
         AND game_files.content_hash = ? AND game_files.active = 1
       LIMIT 1`,
    ).get(context.editionId, context.gameId, context.romContentHash);
    if (!source) throw new Error("Checkpoint Game File identity is no longer current.");
  }

  private async prune(context: CheckpointContext): Promise<void> {
    const lineageId = this.resolveActiveLineageId(context, false);
    if (!lineageId) return;
    const obsolete = this.database.prepare(
      `SELECT id, relative_path
       FROM save_checkpoints
       WHERE lineage_id = ? AND format_key = ?
         AND rom_content_hash = ? AND status IN (${RESTORABLE_STATUSES})
       ORDER BY generation DESC
       LIMIT -1 OFFSET ?`,
    ).all(
      lineageId,
      checkpointFormatKey(context.compatibility),
      context.romContentHash,
      this.maximumRestorableGenerations,
    ) as unknown as Array<{ id: string; relative_path: string }>;
    if (!obsolete.length) return;
    const supersede = this.database.prepare("UPDATE save_checkpoints SET status = 'superseded' WHERE id = ?");
    for (const checkpoint of obsolete) {
      supersede.run(checkpoint.id);
      await removeFile(resolveLibraryPath(this.savesRoot, checkpoint.relative_path));
    }
  }

  /** Archives current progress and returns an empty active lineage for Start New. */
  startNewLineage(context: CheckpointContext, now = new Date()): string {
    this.assertContext(context);
    const lineageId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        `UPDATE checkpoint_lineages
         SET state = 'archived', archived_at = ?
         WHERE edition_id = ? AND player_key = ? AND state = 'active'`,
      ).run(now.toISOString(), context.editionId, context.playerKey);
      this.database.prepare(
        `INSERT INTO checkpoint_lineages(id, edition_id, player_key, state, created_at)
         VALUES (?, ?, ?, 'active', ?)`,
      ).run(lineageId, context.editionId, context.playerKey, now.toISOString());
      this.database.exec("COMMIT");
      return lineageId;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordRestoreAttempt(
    checkpointId: string,
    context: CheckpointContext,
    input: { deviceId: string | null; clientVersion: string; outcome: "verified" | "failed"; observedFrame?: number; reason?: string },
    now = new Date(),
  ): boolean {
    const checkpoint = this.findRestorable(checkpointId, context);
    if (!checkpoint) return false;
    this.database.prepare(
      `INSERT INTO checkpoint_restore_attempts(
         checkpoint_id, device_id, client_version, outcome, observed_frame, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      checkpointId,
      input.deviceId,
      input.clientVersion.trim().slice(0, 80) || "unknown",
      input.outcome,
      input.observedFrame ?? null,
      input.reason?.trim().slice(0, 240) ?? null,
      now.toISOString(),
    );
    if (input.outcome === "verified") {
      this.database.prepare(
        `UPDATE save_checkpoints SET status = 'verified', verified_at = ? WHERE id = ?`,
      ).run(now.toISOString(), checkpointId);
    }
    return true;
  }

  recordRestoreAttemptForProfile(
    checkpointId: string,
    playerKey: string,
    compatibility: CheckpointCompatibility,
    input: { deviceId: string; clientVersion: string; outcome: "verified" | "failed"; observedFrame?: number; reason?: string },
    now = new Date(),
  ): boolean {
    const row = this.database.prepare(
      `SELECT checkpoint.id
       FROM save_checkpoints AS checkpoint
       JOIN checkpoint_lineages AS lineage ON lineage.id = checkpoint.lineage_id
       WHERE checkpoint.id = ? AND checkpoint.player_key = ? AND checkpoint.format_key = ?
         AND checkpoint.status IN (${RESTORABLE_STATUSES}) AND lineage.state = 'active'`,
    ).get(checkpointId, playerKey, checkpointFormatKey(compatibility));
    if (!row) return false;
    this.database.prepare(
      `INSERT INTO checkpoint_restore_attempts(
         checkpoint_id, device_id, client_version, outcome, observed_frame, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      checkpointId,
      input.deviceId,
      input.clientVersion.trim().slice(0, 80) || "unknown",
      input.outcome,
      input.observedFrame ?? null,
      input.reason?.trim().slice(0, 240) ?? null,
      now.toISOString(),
    );
    if (input.outcome === "verified") {
      this.database.prepare(
        "UPDATE save_checkpoints SET status = 'verified', verified_at = ? WHERE id = ?",
      ).run(now.toISOString(), checkpointId);
    }
    return true;
  }

  private resolveActiveLineageId(context: CheckpointContext, create: boolean): string | null {
    if (context.lineageId) {
      const explicit = this.database.prepare(
        `SELECT id FROM checkpoint_lineages
         WHERE id = ? AND edition_id = ? AND player_key = ? AND state = 'active'`,
      ).get(context.lineageId, context.editionId, context.playerKey) as unknown as { id: string } | undefined;
      return explicit?.id ?? null;
    }
    const active = this.database.prepare(
      `SELECT id FROM checkpoint_lineages
       WHERE edition_id = ? AND player_key = ? AND state = 'active'`,
    ).get(context.editionId, context.playerKey) as unknown as { id: string } | undefined;
    if (active) return active.id;
    if (!create) return null;
    const lineageId = randomUUID();
    this.database.prepare(
      `INSERT INTO checkpoint_lineages(id, edition_id, player_key, state, created_at)
       VALUES (?, ?, ?, 'active', ?)`,
    ).run(lineageId, context.editionId, context.playerKey, new Date().toISOString());
    return lineageId;
  }
}

function toStoredCheckpoint(row: CheckpointRow): StoredCheckpoint {
  return {
    id: row.id,
    lineageId: row.lineage_id,
    formatKey: row.format_key,
    generation: row.generation,
    status: row.status,
    byteSize: row.byte_size,
    stateSha256: row.state_sha256,
    capturedFrame: row.captured_frame,
    createdAt: row.created_at,
  };
}

function contextKey(context: CheckpointContext): string {
  const compatibility = context.compatibility;
  return [context.editionId, context.playerKey, context.lineageId ?? "active", checkpointFormatKey(compatibility)].join("\0");
}

export function checkpointFormatKey(compatibility: CheckpointCompatibility): string {
  return compatibility.formatKey
    ?? [compatibility.adapterKey, compatibility.coreKey, compatibility.runtimeVersion].join(":");
}

async function removeFile(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
