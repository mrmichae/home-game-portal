import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";
import type { DiscoveredGameFile } from "../../domain/types.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Household library persistence", () => {
  it("models differently hashed copies of one normalized title as Editions of one Game", () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    const files: DiscoveredGameFile[] = [
      { relativePath: "Beetlejuice (USA).nes", displayName: "Beetlejuice", contentHash: "hash-one", byteSize: 1, modifiedAtMs: 1 },
      { relativePath: "Beetlejuice (USA) [Rev A].nes", displayName: "Beetlejuice", contentHash: "hash-two", byteSize: 2, modifiedAtMs: 2 },
    ];

    expect(catalog.commitScan(files)).toMatchObject({ discovered: 2, added: 2 });
    expect(catalog.listGames()).toHaveLength(1);
    expect(catalog.listGames()[0]).toMatchObject({ displayName: "Beetlejuice" });

    const editionCount = database.prepare("SELECT COUNT(*) AS count FROM editions WHERE active = 1").get() as unknown as { count: number };
    expect(editionCount.count).toBe(2);
    const editions = database.prepare(`
      SELECT editions.id, game_files.relative_path
      FROM editions JOIN game_files ON game_files.edition_id = editions.id
      ORDER BY game_files.relative_path
    `).all() as unknown as Array<{ id: string; relative_path: string }>;
    database.prepare(`INSERT INTO saves(edition_id, player_key, kind, relative_path, byte_size, updated_at)
      VALUES (?, 'household', 'state', ?, 1, ?)`)
      .run(editions[0].id, "household/old.state", "2026-08-21T10:00:00.000Z");
    database.prepare(`INSERT INTO saves(edition_id, player_key, kind, relative_path, byte_size, updated_at)
      VALUES (?, 'household', 'state', ?, 1, ?)`)
      .run(editions[1].id, "household/new.state", "2026-08-21T11:00:00.000Z");
    expect(catalog.getSaveRecord(catalog.listGames()[0].id)?.relativePath).toBe("household/new.state");
    expect(catalog.getPreferredGameFile(catalog.listGames()[0].id)).toBe(editions[1].relative_path);
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
