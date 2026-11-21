import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPortalApplication, type PortalApplication } from "../app.js";
import type { AppConfig } from "../config.js";

const temporaryDirectories: string[] = [];
const servers: Server[] = [];
const portals: PortalApplication[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const portal of portals.splice(0)) portal.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("native v1 API", () => {
  it("pairs a device and protects native resources with its credential", async () => {
    const fixture = await startFixture();
    const system = await fetch(`${fixture.baseUrl}/api/v1/system`);
    expect(system.status).toBe(200);
    expect((await system.json() as { apiVersions: string[] }).apiVersions).toEqual(["1"]);

    const unauthorized = await fetch(`${fixture.baseUrl}/api/v1/profiles`);
    expect(unauthorized.status).toBe(401);

    const credential = "secret-generated-and-kept-by-the-apple-tv";
    const create = await fetch(`${fixture.baseUrl}/api/v1/pairings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceName: "Living Room",
        appVersion: "0.1.0",
        credentialDigest: createHash("sha256").update(credential).digest("hex"),
      }),
    });
    const created = await create.json() as { pairing: { id: string; code: string; pollSecret: string } };
    expect(create.status).toBe(201);

    const approve = await fetch(`${fixture.baseUrl}/api/admin/device-pairings/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: created.pairing.code }),
    });
    expect(approve.status).toBe(200);
    const approved = await approve.json() as { device: { id: string } };

    const status = await fetch(`${fixture.baseUrl}/api/v1/pairings/${created.pairing.id}`, {
      headers: { authorization: `Pairing ${created.pairing.pollSecret}` },
    });
    expect((await status.json() as { pairing: { state: string } }).pairing.state).toBe("approved");

    const profiles = await fetch(`${fixture.baseUrl}/api/v1/profiles`, {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(profiles.status).toBe(200);
    expect((await profiles.json() as { profiles: unknown[] }).profiles).toHaveLength(1);

    const revoke = await fetch(`${fixture.baseUrl}/api/admin/client-devices/${approved.device.id}`, { method: "DELETE" });
    expect(revoke.status).toBe(204);
    const revoked = await fetch(`${fixture.baseUrl}/api/v1/profiles`, {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(revoked.status).toBe(401);
    expect((await revoked.json() as { error: { code: string } }).error.code).toBe("device_revoked");
  });

  it("grants a ROM, checkpoints it, renews the lease, and rejects stale writes", async () => {
    const fixture = await startFixture();
    const credential = pairDirectly(fixture.portal, "Living Room");
    const authorization = `Bearer ${credential}`;
    const game = fixture.portal.catalog.listGames()[0];

    const launch = await fetch(
      `${fixture.baseUrl}/api/v1/games/${game.id}/playback-leases?profileKey=household`,
      {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ intent: "resume" }),
      },
    );
    expect(launch.status).toBe(201);
    const manifest = await launch.json() as {
      lease: { id: string; revision: number };
      gameFile: { downloadUrl: string; sha256: string };
      checkpointUpload: { url: string };
    };

    const gameFile = await fetch(`${fixture.baseUrl}${manifest.gameFile.downloadUrl}`, { headers: { authorization } });
    const gameBytes = Buffer.from(await gameFile.arrayBuffer());
    expect(gameFile.status).toBe(200);
    expect(createHash("sha256").update(gameBytes).digest("hex")).toBe(manifest.gameFile.sha256);

    const checkpointBytes = Buffer.from([1, 2, 3, 4]);
    const captured = await fetch(`${fixture.baseUrl}${manifest.checkpointUpload.url}`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/octet-stream",
        "x-captured-frame": "120",
        "x-lease-revision": String(manifest.lease.revision),
      },
      body: checkpointBytes,
    });
    expect(captured.status).toBe(201);
    const checkpoint = await captured.json() as { checkpoint: { id: string } };

    const restored = await fetch(
      `${fixture.baseUrl}/api/v1/checkpoints/${checkpoint.checkpoint.id}?profileKey=household`,
      { headers: { authorization } },
    );
    expect(Buffer.from(await restored.arrayBuffer())).toEqual(checkpointBytes);

    const renewed = await fetch(`${fixture.baseUrl}/api/v1/playback-leases/${manifest.lease.id}/renew`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ revision: manifest.lease.revision }),
    });
    expect(renewed.status).toBe(200);

    const staleCapture = await fetch(`${fixture.baseUrl}${manifest.checkpointUpload.url}`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/octet-stream",
        "x-captured-frame": "180",
        "x-lease-revision": String(manifest.lease.revision),
      },
      body: Buffer.from([5]),
    });
    expect(staleCapture.status).toBe(409);
    expect((await staleCapture.json() as { error: { code: string } }).error.code).toBe("lease_stale");
  });

  it("reports a named conflict and only replaces it after explicit takeover", async () => {
    const fixture = await startFixture();
    const firstCredential = pairDirectly(fixture.portal, "Living Room");
    const secondCredential = pairDirectly(fixture.portal, "Bedroom");
    const game = fixture.portal.catalog.listGames()[0];
    const launchUrl = `${fixture.baseUrl}/api/v1/games/${game.id}/playback-leases?profileKey=household`;
    const first = await fetch(launchUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${firstCredential}`, "content-type": "application/json" },
      body: JSON.stringify({ intent: "resume" }),
    });
    const firstManifest = await first.json() as { lease: { id: string }; gameFile: { downloadUrl: string } };

    const conflict = await fetch(launchUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${secondCredential}`, "content-type": "application/json" },
      body: JSON.stringify({ intent: "resume" }),
    });
    expect(conflict.status).toBe(409);
    const conflictBody = await conflict.json() as { error: { code: string; details: { activeDeviceName: string; leaseId: string } } };
    expect(conflictBody.error).toMatchObject({
      code: "playback_conflict",
      details: { activeDeviceName: "Living Room", leaseId: firstManifest.lease.id },
    });

    const unconfirmed = await fetch(
      `${fixture.baseUrl}/api/v1/playback-leases/${firstManifest.lease.id}/takeover`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${secondCredential}`, "content-type": "application/json" },
        body: JSON.stringify({ confirm: false }),
      },
    );
    expect(unconfirmed.status).toBe(400);

    const takeover = await fetch(
      `${fixture.baseUrl}/api/v1/playback-leases/${firstManifest.lease.id}/takeover`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${secondCredential}`, "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      },
    );
    expect(takeover.status).toBe(201);

    const revokedGrant = await fetch(`${fixture.baseUrl}${firstManifest.gameFile.downloadUrl}`, {
      headers: { authorization: `Bearer ${firstCredential}` },
    });
    expect(revokedGrant.status).toBe(404);
  });
});

async function startFixture(): Promise<{ portal: PortalApplication; baseUrl: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal-native-api-"));
  temporaryDirectories.push(root);
  const library = path.join(root, "library");
  await mkdir(library, { recursive: true });
  const rom = Buffer.concat([Buffer.from([0x4e, 0x45, 0x53, 0x1a]), Buffer.alloc(28)]);
  await writeFile(path.join(library, "Test Game.nes"), rom);
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    portalName: "Test Portal",
    defaultLibraryRoot: library,
    dataDir: path.join(root, "data"),
    savesDir: path.join(root, "saves"),
    artworkDir: path.join(root, "artwork"),
    migrationsDir: path.resolve(process.cwd(), "migrations"),
    publicDir: path.join(root, "missing-public"),
    clientDir: path.join(root, "missing-client"),
  };
  const portal = createPortalApplication(config, { metadataProvider: { match: async () => [] } });
  portals.push(portal);
  portal.catalog.commitScan([{
    relativePath: "Test Game.nes",
    displayName: "Test Game",
    platform: "nes",
    contentHash: createHash("sha256").update(rom).digest("hex"),
    byteSize: rom.byteLength,
    modifiedAtMs: 1,
  }]);
  const server = portal.app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return { portal, baseUrl: `http://127.0.0.1:${address.port}` };
}

function pairDirectly(portal: PortalApplication, name: string): string {
  const credential = `credential-for-${name}`;
  const pairing = portal.devicePairing.create({
    deviceName: name,
    appVersion: "0.1.0",
    credentialDigest: createHash("sha256").update(credential).digest("hex"),
  });
  portal.devicePairing.approve(pairing.code);
  return credential;
}
