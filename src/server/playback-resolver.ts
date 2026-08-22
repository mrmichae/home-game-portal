import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import type { LaunchManifest } from "../domain/types.js";
import type { CatalogRepository } from "./catalog-repository.js";
import { assertRealPathWithinRoot, resolveLibraryPath } from "./path-security.js";

interface LaunchSession {
  absolutePath: string;
  expiresAt: number;
}

export class PlaybackResolver {
  private readonly sessions = new Map<string, LaunchSession>();

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly ttlMs = 2 * 60 * 1000,
  ) {}

  resolve(gameId: string, now = Date.now(), playerKey = "household"): LaunchManifest {
    const game = this.catalog.getGame(gameId, playerKey);
    const relativePath = this.catalog.getPreferredGameFile(gameId, playerKey);
    if (!game || !relativePath) throw new Error("Game not found.");

    const absolutePath = resolveLibraryPath(this.catalog.getLibraryRoot(), relativePath);
    if (!statSync(absolutePath).isFile()) throw new Error("Game file is unavailable.");
    assertRealPathWithinRoot(
      realpathSync(this.catalog.getLibraryRoot()),
      realpathSync(absolutePath),
    );

    this.prune(now);
    const sessionId = randomBytes(24).toString("base64url");
    this.sessions.set(sessionId, { absolutePath, expiresAt: now + this.ttlMs });
    const save = this.catalog.getSaveRecord(gameId, playerKey);
    const controllerPreset = this.catalog.getPlayerProfile(playerKey)?.controllerPreset ?? "keyboard";
    const emulatorProfile = this.catalog.getEmulatorProfile(game.platform);
    if (!emulatorProfile?.enabled || !emulatorProfile.webPlayback) {
      throw new Error(`Web playback is not configured for ${game.platformName}.`);
    }
    if (emulatorProfile.webPlayback.adapterKey !== "emulatorjs" || emulatorProfile.webPlayback.coreKey !== "fceumm") {
      throw new Error(`The configured web playback adapter is not available for ${game.platformName}.`);
    }

    return {
      sessionId,
      gameId: game.id,
      gameName: game.displayName,
      platform: game.platform,
      emulatorProfile: { platformKey: emulatorProfile.platform.key, policy: emulatorProfile.policy },
      runtime: emulatorProfile.webPlayback.adapterKey,
      playbackProfile: { adapter: emulatorProfile.webPlayback.adapterKey, core: emulatorProfile.webPlayback.coreKey },
      gameUrl: `/api/playback/files/${sessionId}`,
      saveStateUrl: save
        ? `/api/saves/${game.id}/state?profile=${encodeURIComponent(playerKey)}&v=${encodeURIComponent(save.updatedAt)}`
        : null,
      controllerPreset,
      playerProfileKey: playerKey,
    };
  }

  resolveSession(sessionId: string, now = Date.now()): string | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= now) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session.absolutePath;
  }

  private prune(now: number): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(sessionId);
    }
  }
}
