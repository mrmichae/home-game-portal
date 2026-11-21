import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WEB_CHECKPOINT_COMPATIBILITY } from "../../domain/types.js";
import { CatalogRepository } from "../catalog-repository.js";
import { VersionedCheckpointStore } from "../checkpoint-store.js";
import { openMemoryDatabase } from "../database.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Continue Playing dismissal", () => {
  it("persists shelf removal without deleting library or player data", async () => {
    const savesRoot = await mkdtemp(path.join(os.tmpdir(), "portal-continue-playing-"));
    temporaryDirectories.push(savesRoot);
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "Test Game.nes", displayName: "Test Game", platform: "nes", contentHash: "rom-hash", byteSize: 16, modifiedAtMs: 1 },
    ]);
    const game = catalog.getGame(catalog.listGames()[0].id)!;
    const store = new VersionedCheckpointStore(savesRoot, database);
    const context = {
      gameId: game.id,
      editionId: game.editionId,
      playerKey: "household",
      romContentHash: "rom-hash",
      compatibility: WEB_CHECKPOINT_COMPATIBILITY,
    };
    const checkpoint = await store.capture(context, Buffer.from([1, 2, 3]), 120, new Date("2026-08-23T10:00:00.000Z"));
    catalog.setFavorite(game.id, true, new Date("2026-08-23T10:01:00.000Z"));
    catalog.recordPlaySession(game.id, new Date("2026-08-23T10:02:00.000Z"));
    catalog.updateMetadataCorrection(game.id, {
      displayName: "Corrected Test Game",
      releaseYear: 1991,
      description: "Corrected metadata",
      genres: ["Puzzle"],
      series: "Test Series",
      coverUrl: "https://example.invalid/artwork.png",
    });
    const checkpointRow = database.prepare("SELECT relative_path FROM save_checkpoints WHERE id = ?").get(checkpoint.id) as unknown as { relative_path: string };
    const preservedCounts = counts(database);

    expect(catalog.getGame(game.id)).toMatchObject({ hasServerSave: true, isContinuePlaying: true });
    expect(catalog.dismissContinuePlaying(game.id, new Date("2026-08-23T10:03:00.000Z"))).toMatchObject({
      hasServerSave: true,
      isContinuePlaying: false,
      isFavorite: true,
      lastPlayedAt: "2026-08-23T10:02:00.000Z",
      displayName: "Corrected Test Game",
    });
    expect(new CatalogRepository(database).getGame(game.id)?.isContinuePlaying).toBe(false);
    expect(counts(database)).toEqual(preservedCounts);
    expect(await store.readState(checkpoint.id, context)).toEqual(Buffer.from([1, 2, 3]));
    await expect(access(path.join(savesRoot, checkpointRow.relative_path))).resolves.toBeUndefined();

    catalog.recordPlaySession(game.id, new Date("2026-08-23T10:04:00.000Z"));
    expect(catalog.getGame(game.id)?.isContinuePlaying).toBe(true);
    database.close();
  });
});

function counts(database: ReturnType<typeof openMemoryDatabase>): Record<string, number> {
  return Object.fromEntries(["games", "game_files", "favorites", "play_sessions", "save_checkpoints", "saves", "metadata_corrections"].map((table) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as unknown as { count: number };
    return [table, row.count];
  }));
}
