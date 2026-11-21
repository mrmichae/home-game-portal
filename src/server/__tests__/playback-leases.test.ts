import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CatalogRepository } from "../catalog-repository.js";
import { DevicePairing } from "../device-pairing.js";
import { openMemoryDatabase } from "../database.js";
import { PlaybackLeases } from "../playback-leases.js";

const migrationsDir = path.resolve(process.cwd(), "migrations");

describe("Playback Lease module interface", () => {
  it("isolates one active lease per Player Profile and Game and supports explicit takeover", () => {
    const setup = fixture();
    const leases = new PlaybackLeases(setup.database);
    const first = leases.acquire({ gameId: setup.gameId, editionId: setup.editionId, playerKey: "household", deviceId: setup.firstDeviceId }, new Date("2026-09-02T10:00:00Z"));
    expect(first.status).toBe("acquired");

    const conflict = leases.acquire({ gameId: setup.gameId, editionId: setup.editionId, playerKey: "household", deviceId: setup.secondDeviceId }, new Date("2026-09-02T10:00:01Z"));
    expect(conflict).toMatchObject({ status: "conflict", lease: { deviceId: setup.firstDeviceId } });

    const taken = leases.takeover({ gameId: setup.gameId, editionId: setup.editionId, playerKey: "household", deviceId: setup.secondDeviceId }, new Date("2026-09-02T10:00:02Z"));
    expect(taken).toMatchObject({ state: "active", deviceId: setup.secondDeviceId });
    if (first.status !== "acquired") throw new Error("Expected an acquired lease.");
    expect(leases.get(first.lease.id)?.state).toBe("revoked");
    expect(leases.authorize(first.lease.id, setup.firstDeviceId)).toBeNull();
    setup.database.close();
  });

  it("requires the current revision and expires abandoned leases", () => {
    const setup = fixture();
    const leases = new PlaybackLeases(setup.database, 1_000);
    const result = leases.acquire({ gameId: setup.gameId, editionId: setup.editionId, playerKey: "household", deviceId: setup.firstDeviceId }, new Date("2026-09-02T10:00:00Z"));
    if (result.status !== "acquired") throw new Error("Expected an acquired lease.");
    const renewed = leases.renew(result.lease.id, setup.firstDeviceId, 1, new Date("2026-09-02T10:00:00.500Z"));
    expect(renewed.revision).toBe(2);
    expect(() => leases.renew(result.lease.id, setup.firstDeviceId, 1, new Date("2026-09-02T10:00:00.600Z"))).toThrow("stale");
    expect(leases.authorize(result.lease.id, setup.firstDeviceId, new Date("2026-09-02T10:00:02Z"))).toBeNull();

    const replacement = leases.acquire({ gameId: setup.gameId, editionId: setup.editionId, playerKey: "household", deviceId: setup.secondDeviceId }, new Date("2026-09-02T10:00:02Z"));
    expect(replacement.status).toBe("acquired");
    setup.database.close();
  });
});

function fixture() {
  const database = openMemoryDatabase(migrationsDir);
  const catalog = new CatalogRepository(database);
  catalog.ensureLibrarySource("/roms");
  catalog.commitScan([{ relativePath: "Test.nes", displayName: "Test", platform: "nes", contentHash: "rom", byteSize: 16, modifiedAtMs: 1 }]);
  const game = catalog.getGame(catalog.listGames()[0].id)!;
  const pairing = new DevicePairing(database);
  const pair = (name: string) => {
    const credential = `${name}-secret`;
    const created = pairing.create({ deviceName: name, appVersion: "0.1.0", credentialDigest: createHash("sha256").update(credential).digest("hex") });
    return pairing.approve(created.code).id;
  };
  return { database, gameId: game.id, editionId: game.editionId, firstDeviceId: pair("First TV"), secondDeviceId: pair("Second TV") };
}
