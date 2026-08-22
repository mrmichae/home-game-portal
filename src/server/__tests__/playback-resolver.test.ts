import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";
import { PlaybackResolver } from "../playback-resolver.js";
import { VersionedCheckpointStore } from "../checkpoint-store.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Playback Resolver", () => {
  it("resolves the preferred Edition to a scoped URL and an internal NES Playback Profile", async () => {
    const libraryRoot = await temporaryDirectory("portal-launch-");
    await writeFile(path.join(libraryRoot, "test_game.nes"), nesBytes());
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    catalog.commitScan(await scanNesLibrary(libraryRoot));
    const game = catalog.listGames()[0];
    catalog.updatePlayerControllerPreset("household", "joy-con");
    const checkpointStore = new VersionedCheckpointStore(path.join(libraryRoot, "saves"), database);
    const resolver = new PlaybackResolver(catalog, checkpointStore, 1_000);

    const manifest = resolver.resolve(game.id, 1_000);

    expect(manifest.playbackProfile).toEqual({ adapter: "emulatorjs", core: "fceumm" });
    expect(manifest.emulatorProfile).toEqual({ platformKey: "nes", policy: "platform-default" });
    expect(manifest.controllerPreset).toBe("joy-con");
    expect(manifest.gameUrl).toBe(`/api/playback/files/${manifest.sessionId}`);
    expect(manifest.resumePlan.checkpoints).toEqual([]);
    expect(manifest.resumePlan.captureUrl).toContain(`session=${manifest.sessionId}`);
    expect(JSON.stringify(manifest)).not.toContain("test_game.nes");
    expect(resolver.resolveSession(manifest.sessionId, 1_500)).toBe(path.join(libraryRoot, "test_game.nes"));
    expect(resolver.resolveSession(manifest.sessionId, 2_001)).toBeNull();
    const checkpointContext = resolver.resolveCheckpointSession(manifest.sessionId, game.id, "household", 2_001);
    expect(checkpointContext).not.toBeNull();
    const checkpoint = await checkpointStore.capture(
      checkpointContext!,
      Buffer.from([1, 2, 3]),
      120,
      new Date("2026-08-22T10:00:00.000Z"),
    );
    const resumedManifest = resolver.resolve(game.id, 3_000);
    expect(resumedManifest.resumePlan.checkpoints[0]).toMatchObject({
      id: checkpoint.id,
      generation: 1,
      capturedFrame: 120,
      status: "candidate",
    });
    database.close();
  });

  it("rejects a file that does not contain an NES cartridge header", async () => {
    const libraryRoot = await temporaryDirectory("portal-invalid-launch-");
    await writeFile(path.join(libraryRoot, "not_a_game.nes"), Buffer.alloc(4_096));
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource(libraryRoot);
    catalog.commitScan(await scanNesLibrary(libraryRoot));
    const checkpointStore = new VersionedCheckpointStore(path.join(libraryRoot, "saves"), database);
    const resolver = new PlaybackResolver(catalog, checkpointStore);

    expect(() => resolver.resolve(catalog.listGames()[0].id)).toThrow("valid NES game");
    database.close();
  });
});

function nesBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x4e, 0x45, 0x53, 0x1a]), Buffer.alloc(16_380)]);
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
