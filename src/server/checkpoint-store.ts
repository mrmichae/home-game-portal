import { createHash, randomBytes } from "node:crypto";
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
}

export interface StoredCheckpoint {
  id: string;
  generation: number;
  status: "candidate" | "verified";
  capturedFrame: number;
  createdAt: string;
}

interface CheckpointRow {
  id: string;
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
    return this.database
      .prepare(
        `SELECT id, generation, status, relative_path, byte_size, state_sha256, captured_frame, created_at
         FROM save_checkpoints
         WHERE edition_id = ? AND player_key = ?
           AND adapter_key = ? AND core_key = ? AND runtime_version = ?
           AND rom_content_hash = ? AND status IN (${RESTORABLE_STATUSES})
         ORDER BY generation DESC
         LIMIT ?`,
      )
      .all(
        context.editionId,
        context.playerKey,
        context.compatibility.adapterKey,
        context.compatibility.coreKey,
        context.compatibility.runtimeVersion,
        context.romContentHash,
        this.maximumRestorableGenerations,
      )
      .map((row) => toStoredCheckpoint(row as unknown as CheckpointRow));
  }

  async readState(checkpointId: string, context: CheckpointContext): Promise<Buffer | null> {
    const row = this.findRestorable(checkpointId, context);
    if (!row) return null;
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

    const generationRow = this.database.prepare(
      `SELECT COALESCE(MAX(generation), 0) + 1 AS generation
       FROM save_checkpoints
       WHERE edition_id = ? AND player_key = ? AND adapter_key = ? AND core_key = ? AND runtime_version = ?`,
    ).get(
      context.editionId,
      context.playerKey,
      context.compatibility.adapterKey,
      context.compatibility.coreKey,
      context.compatibility.runtimeVersion,
    ) as unknown as { generation: number };
    const generation = generationRow.generation;
    const id = randomBytes(18).toString("base64url");
    const relativeDirectory = path.posix.join(context.playerKey, context.gameId, "checkpoints");
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
           id, edition_id, player_key, adapter_key, core_key, runtime_version,
           rom_content_hash, generation, status, relative_path, byte_size,
           state_sha256, captured_frame, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        context.editionId,
        context.playerKey,
        context.compatibility.adapterKey,
        context.compatibility.coreKey,
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
    return { id, generation, status: "candidate", capturedFrame, createdAt: capturedAt.toISOString() };
  }

  private findRestorable(checkpointId: string, context: CheckpointContext): CheckpointRow | null {
    const row = this.database.prepare(
      `SELECT id, generation, status, relative_path, byte_size, state_sha256, captured_frame, created_at
       FROM save_checkpoints
       WHERE id = ? AND edition_id = ? AND player_key = ?
         AND adapter_key = ? AND core_key = ? AND runtime_version = ?
         AND rom_content_hash = ? AND status IN (${RESTORABLE_STATUSES})`,
    ).get(
      checkpointId,
      context.editionId,
      context.playerKey,
      context.compatibility.adapterKey,
      context.compatibility.coreKey,
      context.compatibility.runtimeVersion,
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
    const obsolete = this.database.prepare(
      `SELECT id, relative_path
       FROM save_checkpoints
       WHERE edition_id = ? AND player_key = ?
         AND adapter_key = ? AND core_key = ? AND runtime_version = ?
         AND rom_content_hash = ? AND status IN (${RESTORABLE_STATUSES})
       ORDER BY generation DESC
       LIMIT -1 OFFSET ?`,
    ).all(
      context.editionId,
      context.playerKey,
      context.compatibility.adapterKey,
      context.compatibility.coreKey,
      context.compatibility.runtimeVersion,
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
}

function toStoredCheckpoint(row: CheckpointRow): StoredCheckpoint {
  return {
    id: row.id,
    generation: row.generation,
    status: row.status,
    capturedFrame: row.captured_frame,
    createdAt: row.created_at,
  };
}

function contextKey(context: CheckpointContext): string {
  const compatibility = context.compatibility;
  return [context.editionId, context.playerKey, compatibility.adapterKey, compatibility.coreKey, compatibility.runtimeVersion].join("\0");
}

async function removeFile(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
