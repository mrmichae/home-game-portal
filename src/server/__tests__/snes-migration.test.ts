import { copyFile, mkdtemp, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openDatabase } from "../database.js";

const migrationsDir = path.resolve(process.cwd(), "migrations");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SNES catalog migration", () => {
  it("widens the Edition platform constraint without losing an existing NES catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "portal-snes-migration-"));
    temporaryDirectories.push(root);
    const dataDir = path.join(root, "data");
    const legacyMigrations = path.join(root, "legacy-migrations");
    await mkdir(legacyMigrations);
    for (const filename of (await readdir(migrationsDir)).filter((item) => item.endsWith(".sql") && item < "015_")) {
      await copyFile(path.join(migrationsDir, filename), path.join(legacyMigrations, filename));
    }

    const legacyDatabase = openDatabase(dataDir, legacyMigrations);
    const legacyCatalog = new CatalogRepository(legacyDatabase);
    legacyCatalog.ensureLibrarySource("/roms");
    legacyCatalog.commitScan([{ relativePath: "NES/Example.nes", displayName: "Example", platform: "nes", contentHash: "nes-hash", byteSize: 1, modifiedAtMs: 1 }]);
    const nesGameId = legacyCatalog.listGames()[0].id;
    legacyCatalog.setFavorite(nesGameId, true);
    legacyDatabase.close();

    const upgradedDatabase = openDatabase(dataDir, migrationsDir);
    const upgradedCatalog = new CatalogRepository(upgradedDatabase);
    expect(upgradedCatalog.getGame(nesGameId)).toMatchObject({ platform: "nes", isFavorite: true });
    expect(upgradedCatalog.getEmulatorProfile("snes")).toMatchObject({ enabled: true, webPlayback: { coreKey: "snes9x" } });

    upgradedCatalog.commitScan([
      { relativePath: "NES/Example.nes", displayName: "Example", platform: "nes", contentHash: "nes-hash", byteSize: 1, modifiedAtMs: 1 },
      { relativePath: "SNES/Example.sfc", displayName: "Example", platform: "snes", contentHash: "snes-hash", byteSize: 2, modifiedAtMs: 2 },
    ]);
    expect(upgradedCatalog.listGames()).toHaveLength(2);
    expect(upgradedDatabase.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    upgradedDatabase.close();
  });
});
