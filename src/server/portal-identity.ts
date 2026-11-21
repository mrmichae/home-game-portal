import { randomUUID } from "node:crypto";
import type { PortalDatabase } from "./database.js";

export interface PortalServerIdentity {
  serverId: string;
  displayName: string;
  createdAt: string;
}

interface IdentityRow {
  server_id: string;
  display_name: string;
  created_at: string;
}

/** Owns the stable identity of one Portal Server across address and process changes. */
export class PortalIdentity {
  constructor(
    private readonly database: PortalDatabase,
    private readonly configuredDisplayName = "Home Game Portal",
  ) {}

  initialize(now = new Date()): PortalServerIdentity {
    const displayName = normalizeDisplayName(this.configuredDisplayName);
    this.database.prepare(
      `INSERT INTO portal_identity(singleton_id, server_id, display_name, created_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(singleton_id) DO UPDATE SET display_name = excluded.display_name`,
    ).run(randomUUID(), displayName, now.toISOString());
    return this.get();
  }

  get(): PortalServerIdentity {
    const row = this.database.prepare(
      "SELECT server_id, display_name, created_at FROM portal_identity WHERE singleton_id = 1",
    ).get() as unknown as IdentityRow | undefined;
    if (!row) throw new Error("Portal Server identity has not been initialized.");
    return { serverId: row.server_id, displayName: row.display_name, createdAt: row.created_at };
  }
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error("Portal Server name must be between 1 and 80 characters.");
  }
  return normalized;
}

