import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { webCheckpointCompatibility } from "../../domain/types.js";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { SavedStateStore } from "../saved-state-store.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Saved State Store", () => {
  it("keeps durable states and thumbnails independent from rolling checkpoints", async () => {
    const { store, context, database } = await fixture("portal-saved-states-");
    const saved = await store.create(context, Buffer.from([1, 2, 3]), 240, new Date("2026-11-03T20:42:00.000Z"));
    await store.attachThumbnail(saved.id, context, Buffer.from("image"), "image/webp");
    const renamed = store.rename(saved.id, context, "Before the final castle");

    expect(renamed).toMatchObject({ label: "Before the final castle", capturedFrame: 240 });
    expect(renamed?.thumbnailUrl).toContain(`/saved-states/${saved.id}/thumbnail`);
    expect(await store.readState(saved.id, context)).toEqual(Buffer.from([1, 2, 3]));
    expect(await store.readThumbnail(saved.id, context)).toEqual({ data: Buffer.from("image"), contentType: "image/webp" });
    expect(await store.delete(saved.id, context)).toBe(true);
    expect(store.list(context)).toEqual([]);
    database.close();
  });

  it("never silently evicts a manual state when the per-game limit is reached", async () => {
    const { savesRoot, context, database } = await fixture("portal-saved-state-limit-");
    const store = new SavedStateStore(savesRoot, database, 2);
    await store.create(context, Buffer.from([1]), 1);
    await store.create(context, Buffer.from([2]), 2);

    await expect(store.create(context, Buffer.from([3]), 3)).rejects.toThrow("Delete a saved state");
    expect(store.list(context)).toHaveLength(2);
    database.close();
  });

  it("detects corruption without deleting the saved-state record", async () => {
    const { savesRoot, store, context, database } = await fixture("portal-saved-state-integrity-");
    const saved = await store.create(context, Buffer.from([1, 2, 3]), 3);
    const row = database.prepare("SELECT relative_path FROM manual_saved_states WHERE id = ?").get(saved.id) as unknown as { relative_path: string };
    await writeFile(path.join(savesRoot, row.relative_path), Buffer.from([9]));

    await expect(store.readState(saved.id, context)).rejects.toThrow("integrity check");
    expect(store.list(context)).toHaveLength(1);
    expect(await readFile(path.join(savesRoot, row.relative_path))).toEqual(Buffer.from([9]));
    database.close();
  });
});

async function fixture(prefix: string) {
  const savesRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(savesRoot);
  const database = openMemoryDatabase(migrationsDir);
  const catalog = new CatalogRepository(database);
  catalog.ensureLibrarySource("/roms");
  catalog.commitScan([{
    relativePath: "Test Game.nes", displayName: "Test Game", platform: "nes" as const,
    contentHash: "rom-hash", byteSize: 1, modifiedAtMs: 1,
  }]);
  const game = catalog.getGame(catalog.listGames()[0].id)!;
  const context = {
    gameId: game.id, editionId: game.editionId, playerKey: "household", romContentHash: "rom-hash",
    compatibility: webCheckpointCompatibility("fceumm"),
  };
  return { savesRoot, database, store: new SavedStateStore(savesRoot, database), context };
}
