import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPortalApplication } from "../app.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Administration Settings application interface", () => {
  it("persists a validated Library Source and rescans the new location", async () => {
    const root = await temporaryDirectory("portal-admin-settings-");
    const initialLibrary = path.join(root, "initial");
    const nextLibrary = path.join(root, "next");
    await mkdir(initialLibrary);
    await mkdir(nextLibrary);
    await writeFile(path.join(nextLibrary, "Configured Game.nes"), "fixture");
    const portal = createPortalApplication({
      host: "127.0.0.1",
      port: 0,
      defaultLibraryRoot: initialLibrary,
      dataDir: path.join(root, "data"),
      savesDir: path.join(root, "saves"),
      artworkDir: path.join(root, "artwork"),
      migrationsDir: path.resolve("migrations"),
      publicDir: path.join(root, "public-missing"),
      clientDir: path.join(root, "client-missing"),
    });
    expect(() => portal.configuration.updateLibraryRoot(path.join(root, "missing"))).toThrow("does not exist");
    expect(portal.catalog.getLibraryRoot()).toBe(initialLibrary);

    portal.configuration.updateLibraryRoot(nextLibrary);
    expect(portal.catalog.getLibraryRoot()).toBe(nextLibrary);

    expect(await portal.rescan()).toMatchObject({ discovered: 1, added: 1 });
    expect(portal.catalog.listGames()[0].displayName).toBe("Configured Game");

    portal.close();

    const restarted = createPortalApplication({
      host: "127.0.0.1",
      port: 0,
      defaultLibraryRoot: initialLibrary,
      dataDir: path.join(root, "data"),
      savesDir: path.join(root, "saves"),
      artworkDir: path.join(root, "artwork"),
      migrationsDir: path.resolve("migrations"),
      publicDir: path.join(root, "public-missing"),
      clientDir: path.join(root, "client-missing"),
    });
    expect(restarted.catalog.getLibraryRoot()).toBe(nextLibrary);
    restarted.close();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
