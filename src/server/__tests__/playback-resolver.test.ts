import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";
import { PlaybackResolver } from "../playback-resolver.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Playback Resolver", () => {
  it("resolves the preferred Edition to a scoped URL and an internal NES Playback Profile", async () => {
    const libraryRoot = await temporaryDirectory("portal-launch-");
    await writeFile(path.join(libraryRoot, "test_game.nes"), "test game bytes");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    catalog.commitScan(await scanNesLibrary(libraryRoot));
    const game = catalog.listGames()[0];
    catalog.updatePlayerControllerPreset("household", "joy-con");
    const resolver = new PlaybackResolver(catalog, 1_000);

    const manifest = resolver.resolve(game.id, 1_000);

    expect(manifest.playbackProfile).toEqual({ adapter: "emulatorjs", core: "fceumm" });
    expect(manifest.emulatorProfile).toEqual({ platformKey: "nes", policy: "platform-default" });
    expect(manifest.controllerPreset).toBe("joy-con");
    expect(manifest.gameUrl).toBe(`/api/playback/files/${manifest.sessionId}`);
    expect(JSON.stringify(manifest)).not.toContain("test_game.nes");
    expect(resolver.resolveSession(manifest.sessionId, 1_500)).toBe(path.join(libraryRoot, "test_game.nes"));
    expect(resolver.resolveSession(manifest.sessionId, 2_001)).toBeNull();
    database.close();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
