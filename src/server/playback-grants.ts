import { randomBytes } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import type { CatalogRepository, PlaybackSourceRecord } from "./catalog-repository.js";
import { assertRealPathWithinRoot, resolveLibraryPath } from "./path-security.js";

const GRANT_TTL_MS = 10 * 60 * 1000;

export interface PlaybackGrant {
  id: string;
  leaseId: string;
  deviceId: string;
  absolutePath: string;
  expiresAt: string;
  source: PlaybackSourceRecord;
}

/** Owns validated, short-lived access to a Game File for one device and lease. */
export class PlaybackGrants {
  private readonly grants = new Map<string, PlaybackGrant>();

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly ttlMs = GRANT_TTL_MS,
  ) {}

  issue(gameId: string, playerKey: string, leaseId: string, deviceId: string, now = new Date()): PlaybackGrant {
    const source = this.catalog.getPlaybackSource(gameId, playerKey);
    if (!source) throw new Error("Game not found.");
    const root = realpathSync(this.catalog.getLibraryRoot());
    const absolutePath = resolveLibraryPath(root, source.relativePath);
    if (!statSync(absolutePath).isFile()) throw new Error("Game file is unavailable.");
    assertRealPathWithinRoot(root, realpathSync(absolutePath));
    assertNesCartridge(absolutePath);
    this.prune(now);
    const grant: PlaybackGrant = {
      id: randomBytes(24).toString("base64url"),
      leaseId,
      deviceId,
      absolutePath,
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      source,
    };
    this.grants.set(grant.id, grant);
    return grant;
  }

  resolve(id: string, deviceId: string, now = new Date()): PlaybackGrant | null {
    this.prune(now);
    const grant = this.grants.get(id);
    return grant?.deviceId === deviceId ? grant : null;
  }

  revokeLease(leaseId: string): void {
    for (const [id, grant] of this.grants) {
      if (grant.leaseId === leaseId) this.grants.delete(id);
    }
  }

  private prune(now: Date): void {
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt <= now.toISOString()) this.grants.delete(id);
    }
  }
}

function assertNesCartridge(absolutePath: string): void {
  const header = Buffer.alloc(4);
  const descriptor = openSync(absolutePath, "r");
  try {
    if (readSync(descriptor, header, 0, header.byteLength, 0) !== header.byteLength
      || !header.equals(Buffer.from([0x4e, 0x45, 0x53, 0x1a]))) {
      throw new Error("The selected file is not a valid NES game.");
    }
  } finally {
    closeSync(descriptor);
  }
}
