import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtworkStore } from "../artwork-store.js";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Metadata Match corrections and artwork cache", () => {
  it("preserves an Administrator correction across a rescan and can reset it", async () => {
    const root = await temporaryDirectory("portal-metadata-");
    const libraryRoot = path.join(root, "library");
    await mkdir(libraryRoot);
    await writeFile(path.join(libraryRoot, "Mystery Game (USA).nes"), "fixture");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    const files = await scanNesLibrary(libraryRoot);
    catalog.commitScan(files);
    const game = catalog.listGames()[0];

    catalog.updateMetadataCorrection(game.id, { displayName: "Corrected Game", releaseYear: 1991, description: "An administrator-provided description.", genres: ["Puzzle"], series: "Corrected Series", coverUrl: "https://example.com/cover.png" });
    catalog.commitScan(files, new Date("2026-08-17T01:00:00.000Z"));
    expect(catalog.getGame(game.id)).toMatchObject({ displayName: "Corrected Game", releaseYear: 1991, genres: ["Puzzle"], metadataStatus: "corrected", sourceDisplayName: "Mystery Game" });

    catalog.clearMetadataCorrection(game.id);
    expect(catalog.getGame(game.id)).toMatchObject({ displayName: "Mystery Game", metadataStatus: "filename" });
    database.close();
  });

  it("serves a previously cached image without contacting a provider", async () => {
    const root = await temporaryDirectory("portal-artwork-");
    const libraryRoot = path.join(root, "library");
    const artworkRoot = path.join(root, "artwork");
    await mkdir(libraryRoot);
    await mkdir(artworkRoot);
    await writeFile(path.join(libraryRoot, "Mega Man (USA).nes"), "fixture");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    catalog.commitScan(await scanNesLibrary(libraryRoot));
    const game = catalog.listGames()[0];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await writeFile(path.join(artworkRoot, `${game.id}.image`), png);

    const result = await new ArtworkStore(artworkRoot, catalog).get(game.id);
    expect(result).toEqual({ data: png, contentType: "image/png" });
    database.close();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
