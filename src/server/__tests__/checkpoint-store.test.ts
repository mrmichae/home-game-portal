import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { VersionedCheckpointStore } from "../checkpoint-store.js";
import { openMemoryDatabase } from "../database.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Versioned Checkpoint Store module interface", () => {
  it("retains the last-known-good generation when a newer checkpoint is rejected", async () => {
    const savesRoot = await temporaryDirectory("portal-checkpoints-");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "Test Game.nes", displayName: "Test Game", contentHash: "rom-hash", byteSize: 1, modifiedAtMs: 1 },
    ]);
    const game = catalog.getGame(catalog.listGames()[0].id)!;
    const store = new VersionedCheckpointStore(savesRoot, database);
    const context = {
      gameId: game.id,
      editionId: game.editionId,
      playerKey: "household",
      romContentHash: "rom-hash",
      compatibility: { adapterKey: "emulatorjs", coreKey: "fceumm", runtimeVersion: "test-runtime" },
    };

    const good = await store.capture(context, Buffer.from([1, 2, 3]), 120, new Date("2026-08-22T10:00:00.000Z"));
    store.verify(good.id, context, 121, new Date("2026-08-22T10:01:00.000Z"));
    const bad = await store.capture(context, Buffer.from([9, 9, 9]), 240, new Date("2026-08-22T10:02:00.000Z"));

    expect(store.listRestorable(context).map((checkpoint) => checkpoint.generation)).toEqual([2, 1]);
    expect(await store.readState(good.id, context)).toEqual(Buffer.from([1, 2, 3]));
    expect(await store.readState(bad.id, context)).toEqual(Buffer.from([9, 9, 9]));

    await store.reject(bad.id, context, "Restored frame did not match the captured frame.", new Date("2026-08-22T10:03:00.000Z"));

    expect(store.listRestorable(context).map((checkpoint) => checkpoint.id)).toEqual([good.id]);
    expect(await store.readState(good.id, context)).toEqual(Buffer.from([1, 2, 3]));
    database.close();
  });

  it("isolates checkpoints by Game File and runtime compatibility", async () => {
    const savesRoot = await temporaryDirectory("portal-checkpoint-identity-");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "Test Game.nes", displayName: "Test Game", contentHash: "rom-hash", byteSize: 1, modifiedAtMs: 1 },
    ]);
    const game = catalog.getGame(catalog.listGames()[0].id)!;
    const store = new VersionedCheckpointStore(savesRoot, database);
    const context = {
      gameId: game.id,
      editionId: game.editionId,
      playerKey: "household",
      romContentHash: "rom-hash",
      compatibility: { adapterKey: "emulatorjs", coreKey: "fceumm", runtimeVersion: "runtime-one" },
    };
    await store.capture(context, Buffer.from([1]), 10);

    expect(store.listRestorable({ ...context, romContentHash: "different-rom" })).toEqual([]);
    expect(store.listRestorable({
      ...context,
      compatibility: { ...context.compatibility, runtimeVersion: "runtime-two" },
    })).toEqual([]);
    database.close();
  });

  it("serializes captures and retains the three newest rollback generations", async () => {
    const savesRoot = await temporaryDirectory("portal-checkpoint-retention-");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "Test Game.nes", displayName: "Test Game", contentHash: "rom-hash", byteSize: 1, modifiedAtMs: 1 },
    ]);
    const game = catalog.getGame(catalog.listGames()[0].id)!;
    const store = new VersionedCheckpointStore(savesRoot, database);
    const context = {
      gameId: game.id,
      editionId: game.editionId,
      playerKey: "household",
      romContentHash: "rom-hash",
      compatibility: { adapterKey: "emulatorjs", coreKey: "fceumm", runtimeVersion: "test-runtime" },
    };

    const checkpoints = await Promise.all([1, 2, 3, 4].map((value) =>
      store.capture(context, Buffer.from([value]), value * 10, new Date(`2026-08-22T10:0${value}:00.000Z`)),
    ));

    expect(checkpoints.map((checkpoint) => checkpoint.generation)).toEqual([1, 2, 3, 4]);
    expect(store.listRestorable(context).map((checkpoint) => checkpoint.generation)).toEqual([4, 3, 2]);
    expect(await store.readState(checkpoints[0].id, context)).toBeNull();
    expect(await store.readState(checkpoints[1].id, context)).toEqual(Buffer.from([2]));
    database.close();
  });

  it("rejects bytes that no longer match the captured checkpoint checksum", async () => {
    const savesRoot = await temporaryDirectory("portal-checkpoint-integrity-");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "Test Game.nes", displayName: "Test Game", contentHash: "rom-hash", byteSize: 1, modifiedAtMs: 1 },
    ]);
    const game = catalog.getGame(catalog.listGames()[0].id)!;
    const store = new VersionedCheckpointStore(savesRoot, database);
    const context = {
      gameId: game.id,
      editionId: game.editionId,
      playerKey: "household",
      romContentHash: "rom-hash",
      compatibility: { adapterKey: "emulatorjs", coreKey: "fceumm", runtimeVersion: "test-runtime" },
    };
    const checkpoint = await store.capture(context, Buffer.from([1, 2, 3]), 10);
    const row = database.prepare("SELECT relative_path FROM save_checkpoints WHERE id = ?")
      .get(checkpoint.id) as unknown as { relative_path: string };
    await writeFile(path.join(savesRoot, row.relative_path), Buffer.from([9, 9, 9]));

    await expect(store.readState(checkpoint.id, context)).rejects.toThrow("integrity check");
    database.close();
  });

  it("removes versioned and legacy progress together for one Player Profile", async () => {
    const savesRoot = await temporaryDirectory("portal-checkpoint-delete-");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "Test Game.nes", displayName: "Test Game", contentHash: "rom-hash", byteSize: 1, modifiedAtMs: 1 },
    ]);
    const game = catalog.getGame(catalog.listGames()[0].id)!;
    const store = new VersionedCheckpointStore(savesRoot, database);
    const context = {
      gameId: game.id,
      editionId: game.editionId,
      playerKey: "household",
      romContentHash: "rom-hash",
      compatibility: { adapterKey: "emulatorjs", coreKey: "fceumm", runtimeVersion: "test-runtime" },
    };
    await store.capture(context, Buffer.from([1]), 10);
    database.prepare(
      `INSERT INTO saves(edition_id, player_key, kind, relative_path, byte_size, updated_at)
       VALUES (?, 'household', 'state', 'household/legacy.state', 1, '2026-08-22T10:00:00.000Z')`,
    ).run(game.editionId);

    await expect(store.deleteGame(game.id, "household")).resolves.toBe(true);
    expect(store.listRestorable(context)).toEqual([]);
    expect((database.prepare("SELECT COUNT(*) AS count FROM saves").get() as unknown as { count: number }).count).toBe(0);
    database.close();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
