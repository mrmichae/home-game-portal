import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DevicePairing } from "../device-pairing.js";
import { PortalIdentity } from "../portal-identity.js";
import { openMemoryDatabase } from "../database.js";

const migrationsDir = path.resolve(process.cwd(), "migrations");

describe("native Client Device pairing", () => {
  it("keeps Portal Server identity stable while allowing its display name to change", () => {
    const database = openMemoryDatabase(migrationsDir);
    const first = new PortalIdentity(database, "Living Room Portal").initialize(new Date("2026-09-02T10:00:00Z"));
    const second = new PortalIdentity(database, "Arcade Portal").initialize(new Date("2026-09-03T10:00:00Z"));

    expect(second).toMatchObject({ serverId: first.serverId, displayName: "Arcade Portal", createdAt: first.createdAt });
    database.close();
  });

  it("approves a short-lived Pairing Request without storing the raw device credential", () => {
    const database = openMemoryDatabase(migrationsDir);
    const pairing = new DevicePairing(database);
    const credential = randomBytes(32).toString("base64url");
    const credentialDigest = createHash("sha256").update(credential).digest("hex");
    const created = pairing.create({ deviceName: "Living Room Apple TV", appVersion: "0.1.0", credentialDigest }, new Date("2026-09-02T10:00:00Z"));

    expect(created.code).toMatch(/^\d{3} \d{3}$/);
    expect(pairing.status(created.id, "wrong", new Date("2026-09-02T10:01:00Z"))).toBeNull();
    const device = pairing.approve(created.code, new Date("2026-09-02T10:02:00Z"));
    expect(pairing.status(created.id, created.pollSecret, new Date("2026-09-02T10:02:01Z"))).toMatchObject({ state: "approved", deviceId: device.id });
    expect(pairing.authenticate(credential, new Date("2026-09-02T10:03:00Z"))).toMatchObject({ id: device.id, displayName: "Living Room Apple TV" });

    const stored = database.prepare("SELECT credential_hash FROM client_devices WHERE id = ?").get(device.id) as unknown as { credential_hash: string };
    expect(stored.credential_hash).toBe(credentialDigest);
    expect(JSON.stringify(database.prepare("SELECT * FROM client_devices").all())).not.toContain(credential);
    database.close();
  });

  it("expires pending requests and revokes paired devices", () => {
    const database = openMemoryDatabase(migrationsDir);
    const pairing = new DevicePairing(database, 1_000);
    const credential = "test-device-secret";
    const credentialDigest = createHash("sha256").update(credential).digest("hex");
    const expired = pairing.create({ deviceName: "Expired TV", appVersion: "0.1.0", credentialDigest }, new Date("2026-09-02T10:00:00Z"));
    expect(pairing.status(expired.id, expired.pollSecret, new Date("2026-09-02T10:00:02Z"))?.state).toBe("expired");
    expect(() => pairing.approve(expired.code, new Date("2026-09-02T10:00:02Z"))).toThrow("invalid or expired");

    const next = pairing.create({ deviceName: "Paired TV", appVersion: "0.1.0", credentialDigest }, new Date("2026-09-02T10:01:00Z"));
    const device = pairing.approve(next.code, new Date("2026-09-02T10:01:00.500Z"));
    expect(pairing.revoke(device.id, new Date("2026-09-02T10:02:00Z"))).toBe(true);
    expect(pairing.authenticate(credential, new Date("2026-09-02T10:03:00Z"))).toBeNull();
    expect(pairing.authenticateResult(credential, new Date("2026-09-02T10:03:00Z"))).toEqual({ status: "revoked" });
    expect(pairing.authenticateResult("unknown", new Date("2026-09-02T10:03:00Z"))).toEqual({ status: "unknown" });
    expect(pairing.listDevices()[0].revokedAt).toBe("2026-09-02T10:02:00.000Z");
    database.close();
  });
});
