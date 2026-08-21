import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogRepository } from "./catalog-repository.js";
import { DEFAULT_PLAYER_KEY } from "./catalog-repository.js";
import { resolveLibraryPath } from "./path-security.js";

export class SaveStore {
  constructor(
    private readonly savesRoot: string,
    private readonly catalog: CatalogRepository,
  ) {}

  async putState(gameId: string, data: Buffer, savedAt = new Date(), playerKey = DEFAULT_PLAYER_KEY): Promise<void> {
    if (data.byteLength === 0) throw new Error("Save state is empty.");
    const relativeDirectory = path.posix.join(playerKey, gameId);
    const relativePath = path.posix.join(relativeDirectory, "latest.state");
    const directory = resolveLibraryPath(this.savesRoot, relativeDirectory);
    const destination = resolveLibraryPath(this.savesRoot, relativePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${destination}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, destination);
    this.catalog.recordSave(gameId, relativePath, data.byteLength, savedAt, playerKey);
  }

  getStatePath(gameId: string, playerKey = DEFAULT_PLAYER_KEY): string | null {
    const save = this.catalog.getSaveRecord(gameId, playerKey);
    return save ? resolveLibraryPath(this.savesRoot, save.relativePath) : null;
  }

  async deleteState(gameId: string, playerKey = DEFAULT_PLAYER_KEY): Promise<boolean> {
    const absolutePath = this.getStatePath(gameId, playerKey);
    if (!absolutePath) return false;
    try {
      await unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.catalog.deleteSaveRecord(gameId, playerKey);
    return true;
  }
}
