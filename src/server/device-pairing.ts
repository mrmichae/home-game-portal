import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PortalDatabase } from "./database.js";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const CREDENTIAL_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type PairingState = "pending" | "approved" | "denied" | "expired";

export interface PairingRequestInput {
  deviceName: string;
  appVersion: string;
  credentialDigest: string;
}

export interface CreatedPairingRequest {
  id: string;
  code: string;
  pollSecret: string;
  expiresAt: string;
}

export interface PairingStatus {
  state: PairingState;
  deviceId: string | null;
  expiresAt: string;
}

export interface PendingPairingRequest {
  id: string;
  deviceName: string;
  appVersion: string;
  createdAt: string;
  expiresAt: string;
}

export interface ClientDevice {
  id: string;
  displayName: string;
  appVersion: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type DeviceAuthentication =
  | { status: "authorized"; device: ClientDevice }
  | { status: "revoked" }
  | { status: "unknown" };

interface PairingRow {
  id: string;
  poll_secret_hash: string;
  code_hash: string;
  credential_hash: string;
  device_name: string;
  app_version: string;
  state: PairingState;
  device_id: string | null;
  created_at: string;
  expires_at: string;
}

interface DeviceRow {
  id: string;
  credential_hash: string;
  display_name: string;
  app_version: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Owns Pairing Request lifecycle, revocable device credentials, and device lookup. */
export class DevicePairing {
  constructor(
    private readonly database: PortalDatabase,
    private readonly pairingTtlMs = PAIRING_TTL_MS,
  ) {}

  create(input: PairingRequestInput, now = new Date()): CreatedPairingRequest {
    const deviceName = normalizeRequired(input.deviceName, "Device name", 80);
    const appVersion = normalizeRequired(input.appVersion, "App version", 40);
    const credentialDigest = input.credentialDigest.toLowerCase();
    if (!CREDENTIAL_DIGEST_PATTERN.test(credentialDigest)) {
      throw new Error("Device credential digest must be a lowercase SHA-256 value.");
    }

    this.expire(now);
    const id = randomUUID();
    const pollSecret = randomBytes(32).toString("base64url");
    const code = this.uniqueCode(now);
    const expiresAt = new Date(now.getTime() + this.pairingTtlMs).toISOString();
    this.database.prepare(
      `INSERT INTO device_pairing_requests(
         id, poll_secret_hash, code_hash, credential_hash, device_name,
         app_version, state, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      digest(pollSecret),
      digest(normalizeCode(code)),
      credentialDigest,
      deviceName,
      appVersion,
      now.toISOString(),
      expiresAt,
    );
    return { id, code, pollSecret, expiresAt };
  }

  status(id: string, pollSecret: string, now = new Date()): PairingStatus | null {
    this.expire(now);
    const row = this.findPairing(id);
    if (!row || !safeDigestEquals(row.poll_secret_hash, pollSecret)) return null;
    return { state: row.state, deviceId: row.device_id, expiresAt: row.expires_at };
  }

  listPending(now = new Date()): PendingPairingRequest[] {
    this.expire(now);
    const rows = this.database.prepare(
      `SELECT id, device_name, app_version, created_at, expires_at
       FROM device_pairing_requests WHERE state = 'pending' ORDER BY created_at`,
    ).all() as unknown as Array<Pick<PairingRow, "id" | "device_name" | "app_version" | "created_at" | "expires_at">>;
    return rows.map((row) => ({
      id: row.id,
      deviceName: row.device_name,
      appVersion: row.app_version,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  approve(code: string, now = new Date()): ClientDevice {
    this.expire(now);
    const row = this.database.prepare(
      `SELECT id, poll_secret_hash, code_hash, credential_hash, device_name, app_version,
              state, device_id, created_at, expires_at
       FROM device_pairing_requests
       WHERE code_hash = ? AND state = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(digest(normalizeCode(code)), now.toISOString()) as unknown as PairingRow | undefined;
    if (!row) throw new Error("Pairing code is invalid or expired.");

    const deviceId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        `INSERT INTO client_devices(id, credential_hash, display_name, app_version, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(deviceId, row.credential_hash, row.device_name, row.app_version, now.toISOString());
      this.database.prepare(
        `UPDATE device_pairing_requests
         SET state = 'approved', device_id = ?, completed_at = ?
         WHERE id = ? AND state = 'pending'`,
      ).run(deviceId, now.toISOString(), row.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error).includes("UNIQUE constraint failed: client_devices.credential_hash")) {
        throw new Error("That Client Device is already paired.");
      }
      throw error;
    }
    return this.findDevice(deviceId)!;
  }

  deny(id: string, now = new Date()): boolean {
    this.expire(now);
    const result = this.database.prepare(
      `UPDATE device_pairing_requests SET state = 'denied', completed_at = ?
       WHERE id = ? AND state = 'pending'`,
    ).run(now.toISOString(), id);
    return result.changes > 0;
  }

  authenticate(credential: string, now = new Date()): ClientDevice | null {
    const result = this.authenticateResult(credential, now);
    return result.status === "authorized" ? result.device : null;
  }

  authenticateResult(credential: string, now = new Date()): DeviceAuthentication {
    if (!credential) return { status: "unknown" };
    const row = this.database.prepare(
      `SELECT id, credential_hash, display_name, app_version, created_at, last_used_at, revoked_at
       FROM client_devices WHERE credential_hash = ?`,
    ).get(digest(credential)) as unknown as DeviceRow | undefined;
    if (!row) return { status: "unknown" };
    if (row.revoked_at) return { status: "revoked" };
    this.database.prepare("UPDATE client_devices SET last_used_at = ? WHERE id = ?")
      .run(now.toISOString(), row.id);
    return { status: "authorized", device: { ...toClientDevice(row), lastUsedAt: now.toISOString() } };
  }

  listDevices(): ClientDevice[] {
    const rows = this.database.prepare(
      `SELECT id, credential_hash, display_name, app_version, created_at, last_used_at, revoked_at
       FROM client_devices ORDER BY created_at`,
    ).all() as unknown as DeviceRow[];
    return rows.map(toClientDevice);
  }

  getDevice(deviceId: string): ClientDevice | null {
    return this.findDevice(deviceId);
  }

  revoke(deviceId: string, now = new Date()): boolean {
    const result = this.database.prepare(
      "UPDATE client_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).run(now.toISOString(), deviceId);
    return result.changes > 0;
  }

  private expire(now: Date): void {
    this.database.prepare(
      `UPDATE device_pairing_requests SET state = 'expired', completed_at = ?
       WHERE state = 'pending' AND expires_at <= ?`,
    ).run(now.toISOString(), now.toISOString());
  }

  private uniqueCode(now: Date): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const number = randomBytes(4).readUInt32BE() % 1_000_000;
      const code = String(number).padStart(6, "0");
      const exists = this.database.prepare(
        `SELECT 1 FROM device_pairing_requests
         WHERE code_hash = ? AND state = 'pending' AND expires_at > ?`,
      ).get(digest(code), now.toISOString());
      if (!exists) return `${code.slice(0, 3)} ${code.slice(3)}`;
    }
    throw new Error("A unique pairing code could not be created. Try again.");
  }

  private findPairing(id: string): PairingRow | null {
    const row = this.database.prepare(
      `SELECT id, poll_secret_hash, code_hash, credential_hash, device_name, app_version,
              state, device_id, created_at, expires_at
       FROM device_pairing_requests WHERE id = ?`,
    ).get(id) as unknown as PairingRow | undefined;
    return row ?? null;
  }

  private findDevice(id: string): ClientDevice | null {
    const row = this.database.prepare(
      `SELECT id, credential_hash, display_name, app_version, created_at, last_used_at, revoked_at
       FROM client_devices WHERE id = ?`,
    ).get(id) as unknown as DeviceRow | undefined;
    return row ? toClientDevice(row) : null;
  }
}

function normalizeRequired(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum} characters.`);
  }
  return normalized;
}

function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, "");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeDigestEquals(expectedDigest: string, candidate: string): boolean {
  const actual = Buffer.from(digest(candidate), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function toClientDevice(row: DeviceRow): ClientDevice {
  return {
    id: row.id,
    displayName: row.display_name,
    appVersion: row.app_version,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
