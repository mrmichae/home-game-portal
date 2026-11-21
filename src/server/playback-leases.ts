import { randomUUID } from "node:crypto";
import type { PortalDatabase } from "./database.js";

const LEASE_TTL_MS = 90_000;
export const LEASE_RENEWAL_INTERVAL_SECONDS = 30;

export interface PlaybackLease {
  id: string;
  gameId: string;
  editionId: string;
  playerKey: string;
  deviceId: string;
  state: "active" | "released" | "revoked" | "expired";
  revision: number;
  startedAt: string;
  heartbeatAt: string;
  expiresAt: string;
  endedAt: string | null;
}

export type AcquireLeaseResult =
  | { status: "acquired"; lease: PlaybackLease }
  | { status: "conflict"; lease: PlaybackLease };

interface LeaseRow {
  id: string;
  game_id: string;
  edition_id: string;
  player_key: string;
  device_id: string;
  state: PlaybackLease["state"];
  revision: number;
  started_at: string;
  heartbeat_at: string;
  expires_at: string;
  ended_at: string | null;
}

/** Owns exclusive play rights and optimistic revisions for native playback. */
export class PlaybackLeases {
  constructor(
    private readonly database: PortalDatabase,
    private readonly leaseTtlMs = LEASE_TTL_MS,
  ) {}

  acquire(
    input: { gameId: string; editionId: string; playerKey: string; deviceId: string },
    now = new Date(),
  ): AcquireLeaseResult {
    this.expire(now);
    const active = this.activeFor(input.gameId, input.playerKey);
    if (active) return active.deviceId === input.deviceId
      ? { status: "acquired", lease: this.renew(active.id, input.deviceId, active.revision, now) }
      : { status: "conflict", lease: active };

    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + this.leaseTtlMs).toISOString();
    this.database.prepare(
      `INSERT INTO playback_leases(
         id, game_id, edition_id, player_key, device_id, state, revision,
         started_at, heartbeat_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
    ).run(
      id, input.gameId, input.editionId, input.playerKey, input.deviceId,
      now.toISOString(), now.toISOString(), expiresAt,
    );
    return { status: "acquired", lease: this.get(id)! };
  }

  renew(id: string, deviceId: string, revision: number, now = new Date()): PlaybackLease {
    this.expire(now);
    const expiresAt = new Date(now.getTime() + this.leaseTtlMs).toISOString();
    const result = this.database.prepare(
      `UPDATE playback_leases
       SET revision = revision + 1, heartbeat_at = ?, expires_at = ?
       WHERE id = ? AND device_id = ? AND state = 'active' AND revision = ?`,
    ).run(now.toISOString(), expiresAt, id, deviceId, revision);
    if (result.changes === 0) throw new Error("Playback Lease is stale or unavailable.");
    return this.get(id)!;
  }

  takeover(
    input: { gameId: string; editionId: string; playerKey: string; deviceId: string },
    now = new Date(),
  ): PlaybackLease {
    this.expire(now);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        `UPDATE playback_leases
         SET state = 'revoked', revision = revision + 1, ended_at = ?
         WHERE game_id = ? AND player_key = ? AND state = 'active'`,
      ).run(now.toISOString(), input.gameId, input.playerKey);
      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + this.leaseTtlMs).toISOString();
      this.database.prepare(
        `INSERT INTO playback_leases(
           id, game_id, edition_id, player_key, device_id, state, revision,
           started_at, heartbeat_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
      ).run(
        id, input.gameId, input.editionId, input.playerKey, input.deviceId,
        now.toISOString(), now.toISOString(), expiresAt,
      );
      this.database.exec("COMMIT");
      return this.get(id)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  release(id: string, deviceId: string, revision: number, now = new Date()): boolean {
    this.expire(now);
    const result = this.database.prepare(
      `UPDATE playback_leases
       SET state = 'released', revision = revision + 1, ended_at = ?
       WHERE id = ? AND device_id = ? AND state = 'active' AND revision = ?`,
    ).run(now.toISOString(), id, deviceId, revision);
    return result.changes > 0;
  }

  authorize(id: string, deviceId: string, now = new Date()): PlaybackLease | null {
    this.expire(now);
    const lease = this.get(id);
    return lease?.state === "active" && lease.deviceId === deviceId ? lease : null;
  }

  get(id: string): PlaybackLease | null {
    const row = this.database.prepare(
      `SELECT id, game_id, edition_id, player_key, device_id, state, revision,
              started_at, heartbeat_at, expires_at, ended_at
       FROM playback_leases WHERE id = ?`,
    ).get(id) as unknown as LeaseRow | undefined;
    return row ? toPlaybackLease(row) : null;
  }

  private activeFor(gameId: string, playerKey: string): PlaybackLease | null {
    const row = this.database.prepare(
      `SELECT id, game_id, edition_id, player_key, device_id, state, revision,
              started_at, heartbeat_at, expires_at, ended_at
       FROM playback_leases
       WHERE game_id = ? AND player_key = ? AND state = 'active'`,
    ).get(gameId, playerKey) as unknown as LeaseRow | undefined;
    return row ? toPlaybackLease(row) : null;
  }

  private expire(now: Date): void {
    this.database.prepare(
      `UPDATE playback_leases
       SET state = 'expired', revision = revision + 1, ended_at = ?
       WHERE state = 'active' AND expires_at <= ?`,
    ).run(now.toISOString(), now.toISOString());
  }
}

function toPlaybackLease(row: LeaseRow): PlaybackLease {
  return {
    id: row.id,
    gameId: row.game_id,
    editionId: row.edition_id,
    playerKey: row.player_key,
    deviceId: row.device_id,
    state: row.state,
    revision: row.revision,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
  };
}

