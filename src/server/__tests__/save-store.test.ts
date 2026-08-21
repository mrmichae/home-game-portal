import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";
import { SaveStore } from "../save-store.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("server save-state persistence", () => {
  it("round-trips save data and exposes it on the next launch", async () => {
    const root = await temporaryDirectory("portal-saves-");
    const libraryRoot = path.join(root, "library");
    const savesRoot = path.join(root, "saves");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(libraryRoot);
    await writeFile(path.join(libraryRoot, "fixture.nes"), "test game");

    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    catalog.commitScan(await scanNesLibrary(libraryRoot));
    const game = catalog.listGames()[0];
    const store = new SaveStore(savesRoot, catalog);
    const state = Buffer.from([0x4e, 0x45, 0x53, 0x1a, 0x01, 0x02]);

    await store.putState(game.id, state, new Date("2026-08-16T12:00:00.000Z"));

    const statePath = store.getStatePath(game.id);
    expect(statePath).not.toBeNull();
    expect(await readFile(statePath!)).toEqual(state);
    expect(catalog.getGame(game.id)).toMatchObject({
      hasServerSave: true,
      saveUpdatedAt: "2026-08-16T12:00:00.000Z",
    });
    const child = catalog.createPlayerProfile("Kid", "tiny-dragon", new Date("2026-08-16T12:05:00.000Z"));
    await store.putState(game.id, Buffer.from([0x89, 0x50]), new Date("2026-08-16T12:10:00.000Z"), child.key);
    expect(await store.deleteState(game.id)).toBe(true);
    expect(store.getStatePath(game.id)).toBeNull();
    expect(catalog.getGame(game.id)?.hasServerSave).toBe(false);
    expect(store.getStatePath(game.id, child.key)).not.toBeNull();
    expect(catalog.getGame(game.id, child.key)?.hasServerSave).toBe(true);
    database.close();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
