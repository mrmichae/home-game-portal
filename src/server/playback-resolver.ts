import { randomBytes } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { webCheckpointCompatibility, type LaunchManifest, type PlatformKey, type WebCoreKey } from "../domain/types.js";
import type { CatalogRepository } from "./catalog-repository.js";
import type { CheckpointContext, VersionedCheckpointStore } from "./checkpoint-store.js";
import { assertRealPathWithinRoot, resolveLibraryPath } from "./path-security.js";

interface LaunchSession {
  absolutePath: string;
  fileExpiresAt: number;
  checkpointExpiresAt: number;
  checkpointContext: CheckpointContext;
}

export class PlaybackResolver {
  private readonly sessions = new Map<string, LaunchSession>();

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly checkpointStore: VersionedCheckpointStore,
    private readonly ttlMs = 2 * 60 * 1000,
    private readonly checkpointTtlMs = 24 * 60 * 60 * 1000,
  ) {}

  resolve(gameId: string, now = Date.now(), playerKey = "household"): LaunchManifest {
    const game = this.catalog.getGame(gameId, playerKey);
    const source = this.catalog.getPlaybackSource(gameId, playerKey);
    if (!game || !source) throw new Error("Game not found.");

    const absolutePath = resolveLibraryPath(this.catalog.getLibraryRoot(), source.relativePath);
    if (!statSync(absolutePath).isFile()) throw new Error("Game file is unavailable.");
    assertRealPathWithinRoot(
      realpathSync(this.catalog.getLibraryRoot()),
      realpathSync(absolutePath),
    );
    assertPlayableGameFile(absolutePath, game.platform);

    this.prune(now);
    const controllerPreset = this.catalog.getPlayerProfile(playerKey)?.controllerPreset ?? "keyboard";
    const emulatorProfile = this.catalog.getEmulatorProfile(game.platform);
    if (!emulatorProfile?.enabled || !emulatorProfile.webPlayback) {
      throw new Error(`Web playback is not configured for ${game.platformName}.`);
    }
    if (emulatorProfile.webPlayback.adapterKey !== "emulatorjs"
      || !isSupportedWebCore(game.platform, emulatorProfile.webPlayback.coreKey)) {
      throw new Error(`The configured web playback adapter is not available for ${game.platformName}.`);
    }
    const checkpointContext = this.checkpointContext(game.id, source, playerKey);
    const sessionId = randomBytes(24).toString("base64url");
    this.sessions.set(sessionId, {
      absolutePath,
      fileExpiresAt: now + this.ttlMs,
      checkpointExpiresAt: now + this.checkpointTtlMs,
      checkpointContext,
    });
    const profileQuery = `profile=${encodeURIComponent(playerKey)}`;
    const checkpoints = this.checkpointStore.listRestorable(checkpointContext);

    return {
      sessionId,
      gameId: game.id,
      gameName: game.displayName,
      platform: game.platform,
      emulatorProfile: { platformKey: emulatorProfile.platform.key, policy: emulatorProfile.policy },
      runtime: emulatorProfile.webPlayback.adapterKey,
      playbackProfile: { adapter: emulatorProfile.webPlayback.adapterKey, core: emulatorProfile.webPlayback.coreKey },
      gameUrl: `/api/playback/files/${sessionId}`,
      resumePlan: {
        captureUrl: `/api/games/${game.id}/checkpoints?session=${encodeURIComponent(sessionId)}&${profileQuery}`,
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.id,
          generation: checkpoint.generation,
          status: checkpoint.status,
          capturedFrame: checkpoint.capturedFrame,
          stateUrl: `/api/games/${game.id}/checkpoints/${checkpoint.id}/state?${profileQuery}`,
          verifyUrl: `/api/games/${game.id}/checkpoints/${checkpoint.id}/verified?${profileQuery}`,
          rejectUrl: `/api/games/${game.id}/checkpoints/${checkpoint.id}/failed?${profileQuery}`,
        })),
      },
      controllerPreset,
      playerProfileKey: playerKey,
    };
  }

  resolveSession(sessionId: string, now = Date.now()): string | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.fileExpiresAt <= now) return null;
    return session.absolutePath;
  }

  resolveCheckpointSession(
    sessionId: string,
    gameId: string,
    playerKey: string,
    now = Date.now(),
  ): CheckpointContext | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.checkpointExpiresAt <= now) {
      this.sessions.delete(sessionId);
      return null;
    }
    const context = session.checkpointContext;
    return context.gameId === gameId && context.playerKey === playerKey ? context : null;
  }

  resolveCheckpointContext(gameId: string, playerKey: string): CheckpointContext | null {
    const source = this.catalog.getPlaybackSource(gameId, playerKey);
    return source ? this.checkpointContext(gameId, source, playerKey) : null;
  }

  private prune(now: number): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.checkpointExpiresAt <= now) this.sessions.delete(sessionId);
    }
  }

  private checkpointContext(
    gameId: string,
    source: { editionId: string; contentHash: string },
    playerKey: string,
  ): CheckpointContext {
    return {
      gameId,
      editionId: source.editionId,
      playerKey,
      romContentHash: source.contentHash,
      compatibility: webCheckpointCompatibility(this.webCoreForGame(gameId)),
    };
  }

  private webCoreForGame(gameId: string): WebCoreKey {
    const game = this.catalog.getGame(gameId);
    const coreKey = game && this.catalog.getEmulatorProfile(game.platform)?.webPlayback?.coreKey;
    if (coreKey === "fceumm" || coreKey === "snes9x") return coreKey;
    throw new Error("The configured web playback adapter is unavailable.");
  }
}

function isSupportedWebCore(platform: PlatformKey, coreKey: string): coreKey is WebCoreKey {
  return (platform === "nes" && coreKey === "fceumm") || (platform === "snes" && coreKey === "snes9x");
}

function assertPlayableGameFile(absolutePath: string, platform: PlatformKey): void {
  if (platform === "nes") return assertNesCartridge(absolutePath);
  if (platform === "snes") return assertSnesCartridge(absolutePath);
  throw new Error("The selected game platform is not supported in the browser.");
}

function assertNesCartridge(absolutePath: string): void {
  const header = Buffer.alloc(4);
  const descriptor = openSync(absolutePath, "r");
  try {
    if (readSync(descriptor, header, 0, header.byteLength, 0) !== header.byteLength
      || !header.equals(Buffer.from([0x4e, 0x45, 0x53, 0x1a]))) {
      throw new Error("The selected file is not a valid NES game. Rescan the Library Source and try again.");
    }
  } finally {
    closeSync(descriptor);
  }
}

function assertSnesCartridge(absolutePath: string): void {
  const size = statSync(absolutePath).size;
  const copierHeaderSize = size % 0x8000 === 512 ? 512 : 0;
  const descriptor = openSync(absolutePath, "r");
  try {
    const plausible = [0x7fc0, 0xffc0, 0x40ffc0].some((baseOffset) => {
      const header = Buffer.alloc(64);
      const offset = copierHeaderSize + baseOffset;
      if (offset + header.byteLength > size || readSync(descriptor, header, 0, header.byteLength, offset) !== header.byteLength) return false;
      return snesHeaderScore(header) >= 4;
    });
    if (!plausible) {
      throw new Error("The selected file is not a valid Super Nintendo game. Rescan the Library Source and try again.");
    }
  } finally {
    closeSync(descriptor);
  }
}

function snesHeaderScore(header: Buffer): number {
  let score = 0;
  const mapMode = header[0x15] & 0x3f;
  if ([0x20, 0x21, 0x22, 0x23, 0x25, 0x30, 0x31, 0x32, 0x35].includes(mapMode)) score += 2;
  const complement = header.readUInt16LE(0x1c);
  const checksum = header.readUInt16LE(0x1e);
  if ((complement ^ checksum) === 0xffff && (complement !== 0 || checksum !== 0)) score += 2;
  if (header.readUInt16LE(0x3c) >= 0x8000) score += 2;
  if (header.subarray(0, 21).filter((byte) => byte === 0 || byte === 0x20 || (byte >= 0x21 && byte <= 0x7e)).length >= 18) score += 1;
  if (header[0x17] >= 0x08 && header[0x17] <= 0x0f) score += 1;
  return score;
}
