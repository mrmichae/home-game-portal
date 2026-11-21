import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SavedState } from "../domain/types.js";
import { checkpointFormatKey, type CheckpointContext } from "./checkpoint-store.js";
import type { PortalDatabase } from "./database.js";
import { resolveLibraryPath } from "./path-security.js";

const MAX_SAVED_STATES_PER_GAME = 10;

interface SavedStateRow {
  id: string;
  relative_path: string;
  byte_size: number;
  state_sha256: string;
  captured_frame: number;
  label: string | null;
  thumbnail_relative_path: string | null;
  thumbnail_content_type: string | null;
  created_at: string;
}

/** Owns durable, player-created states. Unlike recovery checkpoints, these are never pruned. */
export class SavedStateStore {
  constructor(
    private readonly savesRoot: string,
    private readonly database: PortalDatabase,
    private readonly maximumPerGame = MAX_SAVED_STATES_PER_GAME,
  ) {}

  list(context: CheckpointContext): SavedState[] {
    return this.database.prepare(
      `SELECT id, relative_path, byte_size, state_sha256, captured_frame, label,
              thumbnail_relative_path, thumbnail_content_type, created_at
       FROM manual_saved_states
       WHERE edition_id = ? AND player_key = ?
       ORDER BY created_at DESC`,
    ).all(context.editionId, context.playerKey).map((row) => this.toSavedState(row as unknown as SavedStateRow, context));
  }

  find(savedStateId: string, context: CheckpointContext): SavedState | null {
    const row = this.findRow(savedStateId, context);
    return row ? this.toSavedState(row, context) : null;
  }

  async create(context: CheckpointContext, data: Buffer, capturedFrame: number, capturedAt = new Date()): Promise<SavedState> {
    if (!data.byteLength) throw new Error("Saved state is empty.");
    if (!Number.isSafeInteger(capturedFrame) || capturedFrame < 0) throw new Error("Captured frame is invalid.");
    if (this.list(context).length >= this.maximumPerGame) {
      throw new Error(`Delete a saved state before creating another. Each game can keep ${this.maximumPerGame}.`);
    }
    this.assertContext(context);
    const id = randomBytes(18).toString("base64url");
    const relativeDirectory = path.posix.join(context.playerKey, context.gameId, "saved-states");
    const relativePath = path.posix.join(relativeDirectory, `${id}.state`);
    const directory = resolveLibraryPath(this.savesRoot, relativeDirectory);
    const destination = resolveLibraryPath(this.savesRoot, relativePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${destination}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, destination);
    const createdAt = capturedAt.toISOString();
    try {
      this.database.prepare(
        `INSERT INTO manual_saved_states(
           id, edition_id, player_key, format_key, rom_content_hash, relative_path,
           byte_size, state_sha256, captured_frame, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, context.editionId, context.playerKey, checkpointFormatKey(context.compatibility),
        context.romContentHash, relativePath, data.byteLength,
        createHash("sha256").update(data).digest("hex"), capturedFrame, createdAt, createdAt,
      );
    } catch (error) {
      await removeFile(destination);
      throw error;
    }
    return this.find(id, context)!;
  }

  async readState(savedStateId: string, context: CheckpointContext): Promise<Buffer | null> {
    const row = this.findRow(savedStateId, context);
    if (!row) return null;
    const data = await readFile(resolveLibraryPath(this.savesRoot, row.relative_path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!data) return null;
    const checksum = createHash("sha256").update(data).digest("hex");
    if (data.byteLength !== row.byte_size || checksum !== row.state_sha256) throw new Error("Saved state data failed its integrity check.");
    return data;
  }

  async attachThumbnail(savedStateId: string, context: CheckpointContext, data: Buffer, contentType: string): Promise<SavedState> {
    const row = this.findRow(savedStateId, context);
    if (!row) throw new Error("Saved state is unavailable.");
    const extension = contentType === "image/webp" ? "webp" : contentType === "image/jpeg" ? "jpg" : "png";
    const relativePath = path.posix.join(context.playerKey, context.gameId, "saved-states", `${savedStateId}.${extension}`);
    const destination = resolveLibraryPath(this.savesRoot, relativePath);
    const temporary = `${destination}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, destination);
    if (row.thumbnail_relative_path && row.thumbnail_relative_path !== relativePath) await removeFile(resolveLibraryPath(this.savesRoot, row.thumbnail_relative_path));
    this.database.prepare(
      `UPDATE manual_saved_states SET thumbnail_relative_path = ?, thumbnail_content_type = ?, updated_at = ? WHERE id = ?`,
    ).run(relativePath, contentType, new Date().toISOString(), savedStateId);
    return this.find(savedStateId, context)!;
  }

  async readThumbnail(savedStateId: string, context: CheckpointContext): Promise<{ data: Buffer; contentType: string } | null> {
    const row = this.findRow(savedStateId, context);
    if (!row?.thumbnail_relative_path || !row.thumbnail_content_type) return null;
    const data = await readFile(resolveLibraryPath(this.savesRoot, row.thumbnail_relative_path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return data ? { data, contentType: row.thumbnail_content_type } : null;
  }

  rename(savedStateId: string, context: CheckpointContext, label: string): SavedState | null {
    const normalized = label.trim().slice(0, 60);
    const result = this.database.prepare(
      `UPDATE manual_saved_states SET label = ?, updated_at = ? WHERE id = ? AND edition_id = ? AND player_key = ?`,
    ).run(normalized || null, new Date().toISOString(), savedStateId, context.editionId, context.playerKey);
    return result.changes ? this.find(savedStateId, context) : null;
  }

  async delete(savedStateId: string, context: CheckpointContext): Promise<boolean> {
    const row = this.findRow(savedStateId, context);
    if (!row) return false;
    this.database.prepare("DELETE FROM manual_saved_states WHERE id = ? AND edition_id = ? AND player_key = ?")
      .run(savedStateId, context.editionId, context.playerKey);
    await Promise.all([
      removeFile(resolveLibraryPath(this.savesRoot, row.relative_path)),
      row.thumbnail_relative_path ? removeFile(resolveLibraryPath(this.savesRoot, row.thumbnail_relative_path)) : Promise.resolve(),
    ]);
    return true;
  }

  private findRow(savedStateId: string, context: CheckpointContext): SavedStateRow | null {
    const row = this.database.prepare(
      `SELECT id, relative_path, byte_size, state_sha256, captured_frame, label,
              thumbnail_relative_path, thumbnail_content_type, created_at
       FROM manual_saved_states
       WHERE id = ? AND edition_id = ? AND player_key = ? AND format_key = ? AND rom_content_hash = ?`,
    ).get(savedStateId, context.editionId, context.playerKey, checkpointFormatKey(context.compatibility), context.romContentHash);
    return (row as unknown as SavedStateRow | undefined) ?? null;
  }

  private assertContext(context: CheckpointContext): void {
    const source = this.database.prepare(
      `SELECT 1 FROM editions JOIN game_files ON game_files.edition_id = editions.id
       WHERE editions.id = ? AND editions.game_id = ? AND game_files.content_hash = ? AND game_files.active = 1 LIMIT 1`,
    ).get(context.editionId, context.gameId, context.romContentHash);
    if (!source) throw new Error("Saved-state Game File identity is no longer current.");
  }

  private toSavedState(row: SavedStateRow, context: CheckpointContext): SavedState {
    const query = `profile=${encodeURIComponent(context.playerKey)}`;
    return {
      id: row.id,
      label: row.label,
      capturedFrame: row.captured_frame,
      createdAt: row.created_at,
      thumbnailUrl: row.thumbnail_relative_path ? `/api/games/${context.gameId}/saved-states/${row.id}/thumbnail?${query}` : null,
    };
  }
}

async function removeFile(filePath: string): Promise<void> {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
