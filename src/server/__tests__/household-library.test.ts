import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Household library persistence", () => {
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
