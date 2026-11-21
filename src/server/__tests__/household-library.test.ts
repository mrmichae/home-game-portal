import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";
import { WEB_CHECKPOINT_COMPATIBILITY, type DiscoveredGameFile } from "../../domain/types.js";
import { VersionedCheckpointStore } from "../checkpoint-store.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Household library persistence", () => {
  it("does not select a legacy AppleDouble sidecar as the preferred game file", () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "._Beetlejuice.nes", displayName: "Beetlejuice", platform: "nes", contentHash: "sidecar", byteSize: 4_096, modifiedAtMs: 2 },
      { relativePath: "Beetlejuice.nes", displayName: "Beetlejuice", platform: "nes", contentHash: "game", byteSize: 131_088, modifiedAtMs: 1 },
    ]);

    const game = catalog.listGames()[0];
    expect(catalog.getPreferredGameFile(game.id)).toBe("Beetlejuice.nes");
    expect(game.byteSize).toBe(131_088);
    database.close();
  });

  it("models differently hashed copies of one normalized title as Editions of one Game", async () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    const files: DiscoveredGameFile[] = [
      { relativePath: "Beetlejuice (USA).nes", displayName: "Beetlejuice", platform: "nes", contentHash: "hash-one", byteSize: 1, modifiedAtMs: 1 },
      { relativePath: "Beetlejuice (USA) [Rev A].nes", displayName: "Beetlejuice", platform: "nes", contentHash: "hash-two", byteSize: 2, modifiedAtMs: 2 },
    ];

    expect(catalog.commitScan(files)).toMatchObject({ discovered: 2, added: 2 });
    expect(catalog.listGames()).toHaveLength(1);
    expect(catalog.listGames()[0]).toMatchObject({ displayName: "Beetlejuice" });

    const editionCount = database.prepare("SELECT COUNT(*) AS count FROM editions WHERE active = 1").get() as unknown as { count: number };
    expect(editionCount.count).toBe(2);
    const editions = database.prepare(`
      SELECT editions.id, game_files.relative_path, game_files.content_hash
      FROM editions JOIN game_files ON game_files.edition_id = editions.id
      ORDER BY game_files.relative_path
    `).all() as unknown as Array<{ id: string; relative_path: string; content_hash: string }>;
    const savesRoot = await mkdtemp(path.join(os.tmpdir(), "portal-edition-checkpoints-"));
    temporaryDirectories.push(savesRoot);
    const store = new VersionedCheckpointStore(savesRoot, database);
    await store.capture({
      gameId: catalog.listGames()[0].id,
      editionId: editions[1].id,
      playerKey: "household",
      romContentHash: editions[1].content_hash,
      compatibility: WEB_CHECKPOINT_COMPATIBILITY,
    }, Buffer.from([1]), 10, new Date("2026-08-21T11:00:00.000Z"));
    expect(catalog.listGames()[0].hasServerSave).toBe(true);
    expect(catalog.getPreferredGameFile(catalog.listGames()[0].id)).toBe(editions[1].relative_path);
    database.close();
  });

  it("keeps same-named NES and SNES titles as separate platform Games", () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "NES/Example Game.nes", displayName: "Example Game", platform: "nes", contentHash: "nes-hash", byteSize: 1, modifiedAtMs: 1 },
      { relativePath: "SNES/Example Game.sfc", displayName: "Example Game", platform: "snes", contentHash: "snes-hash", byteSize: 2, modifiedAtMs: 2 },
    ]);

    expect(catalog.listGames()).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Example Game", platform: "nes" }),
      expect.objectContaining({ displayName: "Example Game", platform: "snes" }),
    ]));
    expect(catalog.listGames()).toHaveLength(2);
    database.close();
  });

  it("stores Favorites and recent Play Sessions for the default Player Profile", async () => {
    const libraryRoot = await mkdtemp(path.join(os.tmpdir(), "portal-household-"));
    temporaryDirectories.push(libraryRoot);
    await writeFile(path.join(libraryRoot, "Mega Man (USA).nes"), "mega man fixture");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    catalog.commitScan(await scanNesLibrary(libraryRoot));
    const game = catalog.listGames()[0];

    catalog.setFavorite(game.id, true, new Date("2026-08-16T10:00:00.000Z"));
    catalog.recordPlaySession(game.id, new Date("2026-08-16T11:00:00.000Z"));

    expect(catalog.getGame(game.id)).toMatchObject({
      isFavorite: true,
      lastPlayedAt: "2026-08-16T11:00:00.000Z",
      series: "Mega Man",
    });
    catalog.setFavorite(game.id, false);
    expect(catalog.getGame(game.id)?.isFavorite).toBe(false);

    const child = catalog.createPlayerProfile("Alex", "forest-adventurer", new Date("2026-08-16T12:00:00.000Z"));
    expect(child).toMatchObject({ avatarKey: "forest-adventurer", avatarColor: "#27a65b" });
    catalog.setFavorite(game.id, true, new Date("2026-08-16T12:30:00.000Z"), child.key);
    catalog.recordPlaySession(game.id, new Date("2026-08-16T13:00:00.000Z"), child.key);
    expect(catalog.getGame(game.id)?.isFavorite).toBe(false);
    expect(catalog.getGame(game.id, child.key)).toMatchObject({ isFavorite: true, lastPlayedAt: "2026-08-16T13:00:00.000Z" });

    catalog.updatePlayerPreferences(child.key, "snes", "#8f73d8");
    expect(catalog.getPlayerProfile(child.key)).toMatchObject({ displayName: "Alex", themeKey: "snes", accentColor: "#8f73d8" });
    catalog.updatePlayerControllerPreset(child.key, "switch-pro");
    expect(catalog.getPlayerProfile(child.key)?.controllerPreset).toBe("switch-pro");
    expect(() => catalog.updatePlayerControllerPreset(child.key, "mystery-pad")).toThrow("Controller preset is invalid.");
    catalog.updatePlayerIdentity(child.key, "Alex Arcade", "cosmic-cat");
    expect(catalog.getPlayerProfile(child.key)).toMatchObject({ displayName: "Alex Arcade", avatarKey: "cosmic-cat", avatarColor: "#17d6c0" });
    expect(() => catalog.updatePlayerIdentity(child.key, "Alex", "not-an-avatar")).toThrow("Choose one of the available profile avatars.");
    database.close();
  });
});
