import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { scanNesLibrary } from "../library-scanner.js";
import { PortalConfiguration } from "../portal-configuration.js";

const temporaryDirectories: string[] = [];
const migrationsDir = path.resolve(process.cwd(), "migrations");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Portal Configuration", () => {
  it("uses the deployment path only to initialize and preserves the SQLite value afterward", async () => {
    const root = await temporaryDirectory("portal-configuration-");
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await mkdir(first);
    await mkdir(second);
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);

    new PortalConfiguration(catalog, first).initialize();
    new PortalConfiguration(catalog, second).initialize();

    expect(catalog.getLibraryRoot()).toBe(first);
    database.close();
  });

  it("validates a new path, scans it read-only, and leaves an invalid update unapplied", async () => {
    const root = await temporaryDirectory("portal-library-change-");
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await mkdir(first);
    await mkdir(second);
    const gamePath = path.join(second, "New Location Game (USA).nes");
    const bytes = Buffer.from("unchanged ROM fixture");
    await writeFile(gamePath, bytes);
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    const configuration = new PortalConfiguration(catalog, first);
    configuration.initialize();

    configuration.updateLibraryRoot(second);
    catalog.commitScan(await scanNesLibrary(catalog.getLibraryRoot()));

    expect(catalog.listGames()).toHaveLength(1);
    expect(catalog.listGames()[0].displayName).toBe("New Location Game");
    expect(await readFile(gamePath)).toEqual(bytes);
    expect(() => configuration.updateLibraryRoot(path.join(root, "missing"))).toThrow("does not exist");
    expect(catalog.getLibraryRoot()).toBe(second);
    database.close();
  });

  it("exposes platform-level Emulator Profiles without attaching them to Games", async () => {
    const root = await temporaryDirectory("portal-emulators-");
    const database = openMemoryDatabase(migrationsDir);
    const catalog = new CatalogRepository(database);
    const configuration = new PortalConfiguration(catalog, root);
    configuration.initialize();

    const settings = configuration.settings({ status: "idle", lastScannedAt: null, message: null });

    expect(settings.emulators.map((profile) => profile.platform.key)).toEqual(["nes", "snes", "atari2600"]);
    expect(settings.emulators[0]).toMatchObject({ enabled: true, policy: "platform-default", webPlayback: { adapterKey: "emulatorjs", coreKey: "fceumm" } });
    expect(settings.emulators[1]).toMatchObject({ enabled: true, webPlayback: { adapterKey: "emulatorjs", coreKey: "snes9x" } });
    database.close();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
