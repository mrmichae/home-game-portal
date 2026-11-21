import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { AppConfig } from "./config.js";
import { CatalogRepository, DEFAULT_PLAYER_KEY, type ScanCommitResult } from "./catalog-repository.js";
import { openDatabase, type PortalDatabase } from "./database.js";
import { scanGameLibrary } from "./library-scanner.js";
import { PlaybackResolver } from "./playback-resolver.js";
import { VersionedCheckpointStore } from "./checkpoint-store.js";
import { ArtworkStore } from "./artwork-store.js";
import { PortalConfiguration } from "./portal-configuration.js";
import { PortalPresentation } from "./portal-presentation.js";
import type { BrowseRowInput, CollectionInput, MetadataCorrectionInput, ScanStatus } from "../domain/types.js";
import { PortalMetadataProvider, type MetadataProvider } from "./metadata-provider.js";
import { DevicePairing, type ClientDevice } from "./device-pairing.js";
import { PortalIdentity } from "./portal-identity.js";
import { PlaybackLeases, LEASE_RENEWAL_INTERVAL_SECONDS, type PlaybackLease } from "./playback-leases.js";
import { PlaybackGrants, type PlaybackGrant } from "./playback-grants.js";
import { NATIVE_CHECKPOINT_COMPATIBILITY } from "../domain/types.js";
import type { CheckpointContext } from "./checkpoint-store.js";
import { PairingRateLimiter } from "./pairing-rate-limiter.js";
import { SavedStateStore } from "./saved-state-store.js";

const PORTAL_SERVER_VERSION = "0.1.0";
const NATIVE_API_VERSION = "1";

export interface PortalApplication {
  app: Express;
  database: PortalDatabase;
  catalog: CatalogRepository;
  configuration: PortalConfiguration;
  presentation: PortalPresentation;
  identity: PortalIdentity;
  devicePairing: DevicePairing;
  playbackLeases: PlaybackLeases;
  rescan: () => Promise<ScanCommitResult>;
  close: () => void;
}

interface PortalApplicationDependencies {
  metadataProvider?: MetadataProvider;
}

export function createPortalApplication(config: AppConfig, dependencies: PortalApplicationDependencies = {}): PortalApplication {
  const database = openDatabase(config.dataDir, config.migrationsDir);
  const catalog = new CatalogRepository(database);
  const configuration = new PortalConfiguration(catalog, config.defaultLibraryRoot);
  configuration.initialize();
  const presentation = new PortalPresentation(database);
  const checkpointStore = new VersionedCheckpointStore(config.savesDir, database);
  const savedStateStore = new SavedStateStore(config.savesDir, database);
  const playbackResolver = new PlaybackResolver(catalog, checkpointStore);
  const artworkStore = new ArtworkStore(config.artworkDir, catalog);
  const metadataProvider = dependencies.metadataProvider ?? new PortalMetadataProvider(path.join(config.dataDir, "metadata"));
  const identityStore = new PortalIdentity(database, config.portalName);
  const identity = identityStore.initialize();
  const devicePairing = new DevicePairing(database);
  const playbackLeases = new PlaybackLeases(database);
  const playbackGrants = new PlaybackGrants(catalog);
  const pairingRateLimiter = new PairingRateLimiter();
  const app = express();
  let scanState: ScanStatus = { status: "idle", lastScannedAt: catalog.getLibrarySource().lastScannedAt, message: null };
  let activeScan: Promise<ScanCommitResult> | null = null;

  const rescan = (): Promise<ScanCommitResult> => {
    if (activeScan) return activeScan;
    scanState = { ...scanState, status: "scanning", message: null };
    const libraryRoot = catalog.getLibraryRoot();
    activeScan = scanGameLibrary(libraryRoot)
      .then(async (files) => {
        const matches = await metadataProvider.match(files).catch((error: unknown) => {
          console.warn("[Home Game Portal] Metadata enrichment skipped; the library scan will continue.", error);
          return [];
        });
        const result = catalog.commitScan(files, new Date(), matches);
        scanState = {
          status: "idle",
          lastScannedAt: new Date().toISOString(),
          message: null,
        };
        return result;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Library scan failed.";
        scanState = { ...scanState, status: "error", message };
        throw error;
      })
      .finally(() => {
        activeScan = null;
      });
    return activeScan;
  };

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Portal-Request-ID", randomUUID());
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const healthHandler = (_request: Request, response: Response) => {
    database.prepare("SELECT 1").get();
    const library = configuration.inspectLibrarySource();
    response.json({ status: "ok", database: "available", library: library.available ? "available" : "unavailable" });
  };
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  const playerKeyFor = (request: Request): string => {
    const queryProfile = typeof request.query.profile === "string" ? request.query.profile : null;
    const headerProfile = typeof request.headers["x-player-profile"] === "string" ? request.headers["x-player-profile"] : null;
    const requested = queryProfile ?? headerProfile ?? DEFAULT_PLAYER_KEY;
    return catalog.getPlayerProfile(requested)?.key ?? DEFAULT_PLAYER_KEY;
  };
  const requireAdministrator = (request: Request, response: Response): boolean => {
    if (catalog.getPlayerProfile(playerKeyFor(request))?.isAdministrator) return true;
    response.status(403).json({ message: "Administrator access is required." });
    return false;
  };
  const requireClientDevice = (request: Request, response: Response): ClientDevice | null => {
    const authorization = request.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    const result = match ? devicePairing.authenticateResult(match[1]) : { status: "unknown" as const };
    if (result.status === "authorized") return result.device;
    if (result.status === "revoked") {
      v1Error(response, 401, "device_revoked", "This Client Device was revoked. Pair it again to continue.");
      return null;
    }
    v1Error(response, 401, "device_unauthorized", "Pair this Client Device with the Portal Server.");
    return null;
  };
  const v1PlayerKeyFor = (request: Request, response: Response): string | null => {
    const profileKey = typeof request.query.profileKey === "string" ? request.query.profileKey : "";
    if (profileKey && catalog.getPlayerProfile(profileKey)) return profileKey;
    v1Error(response, 404, "profile_not_found", "That Player Profile is no longer available.");
    return null;
  };

  app.get("/api/v1/system", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({
      serverId: identity.serverId,
      serverName: identity.displayName,
      serverVersion: PORTAL_SERVER_VERSION,
      apiVersions: [NATIVE_API_VERSION],
      minimumClientVersion: "0.1.0",
      pairingRequired: true,
      transport: { scope: "trusted-lan", https: false },
      capabilities: {
        platforms: ["nes"],
        nativePlayback: [{ platformKey: "nes", coreKey: "fceumm" }],
        checkpointFormats: [{
          key: NATIVE_CHECKPOINT_COMPATIBILITY.formatKey,
          coreKey: "fceumm",
          status: "provisional",
        }],
      },
    });
  });

  app.post("/api/v1/pairings", (request, response) => {
    if (!pairingRateLimiter.allow(request.ip ?? request.socket.remoteAddress ?? "unknown")) {
      response.setHeader("Retry-After", "600");
      return v1Error(response, 429, "pairing_rate_limited", "Wait before starting another Pairing Request.", true);
    }
    try {
      const pairing = devicePairing.create({
        deviceName: String(request.body?.deviceName ?? ""),
        appVersion: String(request.body?.appVersion ?? ""),
        credentialDigest: String(request.body?.credentialDigest ?? ""),
      });
      response.setHeader("Cache-Control", "no-store");
      return response.status(201).json({ pairing });
    } catch (error) {
      return v1Error(response, 400, "invalid_pairing_request", error instanceof Error ? error.message : "Pairing could not begin.");
    }
  });

  app.get("/api/v1/pairings/:pairingId", (request, response) => {
    const authorization = request.headers.authorization ?? "";
    const match = /^Pairing\s+(.+)$/i.exec(authorization);
    const status = match ? devicePairing.status(request.params.pairingId, match[1]) : null;
    response.setHeader("Cache-Control", "no-store");
    return status
      ? response.json({ pairing: status })
      : v1Error(response, 404, "pairing_not_found", "That Pairing Request is unavailable.");
  });

  app.get("/api/admin/device-pairings", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    response.json({ pairings: devicePairing.listPending() });
  });

  app.post("/api/admin/device-pairings/approve", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      return response.json({ device: devicePairing.approve(String(request.body?.code ?? "")) });
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Pairing could not be approved." });
    }
  });

  app.post("/api/admin/device-pairings/:pairingId/deny", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    return devicePairing.deny(request.params.pairingId)
      ? response.status(204).send()
      : response.status(404).json({ message: "That Pairing Request is unavailable." });
  });

  app.get("/api/admin/client-devices", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    response.json({ devices: devicePairing.listDevices() });
  });

  app.delete("/api/admin/client-devices/:deviceId", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    return devicePairing.revoke(request.params.deviceId)
      ? response.status(204).send()
      : response.status(404).json({ message: "That Client Device is unavailable." });
  });

  app.get("/api/v1/profiles", (request, response) => {
    if (!requireClientDevice(request, response)) return;
    response.json({ profiles: catalog.listPlayerProfiles() });
  });

  app.get("/api/v1/catalog", (request, response) => {
    if (!requireClientDevice(request, response)) return;
    const playerKey = v1PlayerKeyFor(request, response);
    if (!playerKey) return;
    // API v1 is the NES-only native tvOS contract. Browser SNES support must
    // not advertise titles that this client cannot launch.
    const games = catalog.listGames(playerKey).filter((game) => game.platform === "nes");
    const body = {
      shelf: { id: "nintendo-entertainment-system", title: "Nintendo Entertainment System", games },
      scan: scanState,
      presentation: presentation.catalog(games),
    };
    return versionedJson(request, response, body);
  });

  app.get("/api/v1/games/:gameId", (request, response) => {
    if (!requireClientDevice(request, response)) return;
    const playerKey = v1PlayerKeyFor(request, response);
    if (!playerKey) return;
    const found = catalog.getGame(request.params.gameId, playerKey);
    const game = found?.platform === "nes" ? found : null;
    return game
      ? versionedJson(request, response, { game })
      : v1Error(response, 404, "game_not_found", "That Game is no longer in this Catalog.");
  });

  app.put("/api/v1/games/:gameId/favorite", (request, response) => {
    if (!requireClientDevice(request, response)) return;
    const playerKey = v1PlayerKeyFor(request, response);
    if (!playerKey) return;
    if (typeof request.body?.favorite !== "boolean") {
      return v1Error(response, 400, "favorite_required", "Choose whether this Game belongs in Favorites.");
    }
    try {
      const game = catalog.setFavorite(request.params.gameId, request.body.favorite, new Date(), playerKey);
      return versionedJson(request, response, { game });
    } catch (error) {
      return v1Error(response, 404, "game_not_found", error instanceof Error ? error.message : "That Game is unavailable.");
    }
  });

  app.delete("/api/v1/games/:gameId/continue-playing", (request, response) => {
    if (!requireClientDevice(request, response)) return;
    const playerKey = v1PlayerKeyFor(request, response);
    if (!playerKey) return;
    try {
      return response.json({ game: catalog.dismissContinuePlaying(request.params.gameId, new Date(), playerKey) });
    } catch (error) {
      return v1Error(response, 404, "game_not_found", error instanceof Error ? error.message : "That Game is unavailable.");
    }
  });

  const checkpointContextForLease = (lease: PlaybackLease, device: ClientDevice): CheckpointContext | null => {
    const source = catalog.getPlaybackSource(lease.gameId, lease.playerKey);
    if (!source || source.editionId !== lease.editionId) return null;
    return {
      gameId: lease.gameId,
      editionId: lease.editionId,
      playerKey: lease.playerKey,
      romContentHash: source.contentHash,
      compatibility: { ...NATIVE_CHECKPOINT_COMPATIBILITY, runtimeVersion: device.appVersion },
    };
  };
  const nativeLeasePayload = (
    lease: PlaybackLease,
    grant: PlaybackGrant,
    context: CheckpointContext,
    intent: "resume" | "fresh",
  ) => ({
    lease: {
      id: lease.id,
      revision: lease.revision,
      expiresAt: lease.expiresAt,
      renewalIntervalSeconds: LEASE_RENEWAL_INTERVAL_SECONDS,
      controlEvents: [],
    },
    game: { id: lease.gameId, editionId: lease.editionId, platformKey: "nes" },
    gameFile: {
      grantId: grant.id,
      downloadUrl: `/api/v1/playback-grants/${grant.id}/game`,
      expiresAt: grant.expiresAt,
      byteSize: grant.source.byteSize,
      sha256: grant.source.contentHash,
    },
    emulator: {
      adapterKey: NATIVE_CHECKPOINT_COMPATIBILITY.adapterKey,
      coreKey: NATIVE_CHECKPOINT_COMPATIBILITY.coreKey,
      coreRevision: NATIVE_CHECKPOINT_COMPATIBILITY.runtimeVersion,
      checkpointFormatKey: NATIVE_CHECKPOINT_COMPATIBILITY.formatKey,
    },
    intent,
    checkpoints: checkpointStore.listRestorable(context).map((checkpoint) => ({
      ...checkpoint,
      downloadUrl: `/api/v1/checkpoints/${checkpoint.id}?profileKey=${encodeURIComponent(lease.playerKey)}`,
    })),
    checkpointUpload: {
      url: `/api/v1/playback-leases/${lease.id}/checkpoints`,
      maximumBytes: 12 * 1024 * 1024,
      requiredLeaseRevision: lease.revision,
    },
  });

  app.post("/api/v1/games/:gameId/playback-leases", (request, response) => {
    const device = requireClientDevice(request, response);
    if (!device) return;
    const playerKey = v1PlayerKeyFor(request, response);
    if (!playerKey) return;
    const intent = request.body?.intent === "fresh" ? "fresh" : request.body?.intent === "resume" ? "resume" : null;
    if (!intent) return v1Error(response, 400, "playback_intent_required", "Choose Resume or Start New.");
    if (catalog.getGame(request.params.gameId, playerKey)?.platform !== "nes") {
      return v1Error(response, 404, "game_not_found", "That Game is not available on this Client Device.");
    }
    const source = catalog.getPlaybackSource(request.params.gameId, playerKey);
    if (!source) return v1Error(response, 404, "game_not_found", "That Game is no longer in this Catalog.");
    try {
      const result = playbackLeases.acquire({
        gameId: request.params.gameId,
        editionId: source.editionId,
        playerKey,
        deviceId: device.id,
      });
      if (result.status === "conflict") {
        const activeDevice = devicePairing.getDevice(result.lease.deviceId);
        return v1Error(response, 409, "playback_conflict", "This Game is already active on another device.", false, {
          activeDeviceName: activeDevice?.displayName ?? "Another device",
          leaseStartedAt: result.lease.startedAt,
          takeoverEligible: true,
          leaseId: result.lease.id,
        });
      }
      let context = checkpointContextForLease(result.lease, device);
      if (!context) return v1Error(response, 409, "game_file_changed", "The Game File changed while playback was starting.");
      const grant = playbackGrants.issue(request.params.gameId, playerKey, result.lease.id, device.id);
      if (intent === "fresh") {
        const lineageId = checkpointStore.startNewLineage(context);
        context = { ...context, lineageId };
      }
      catalog.recordPlaySession(request.params.gameId, new Date(), playerKey);
      response.setHeader("Cache-Control", "no-store");
      return response.status(201).json(nativeLeasePayload(result.lease, grant, context, intent));
    } catch (error) {
      return v1Error(response, 409, "playback_unavailable", error instanceof Error ? error.message : "Playback could not start.");
    }
  });

  app.get("/api/v1/playback-grants/:grantId/game", (request, response) => {
    const device = requireClientDevice(request, response);
    if (!device) return;
    const grant = playbackGrants.resolve(request.params.grantId, device.id);
    const lease = grant ? playbackLeases.authorize(grant.leaseId, device.id) : null;
    if (!grant || !lease) {
      return v1Error(response, 404, "playback_grant_unavailable", "This Game File grant expired. Start playback again.");
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", 'inline; filename="game.nes"');
    return response.sendFile(grant.absolutePath);
  });

  app.post("/api/v1/playback-leases/:leaseId/renew", (request, response) => {
    const device = requireClientDevice(request, response);
    if (!device) return;
    const revision = leaseRevisionFor(request);
    if (!revision) return v1Error(response, 428, "lease_revision_required", "The current Playback Lease revision is required.");
    try {
      const lease = playbackLeases.renew(request.params.leaseId, device.id, revision);
      response.setHeader("Cache-Control", "no-store");
      return response.json({ lease: { ...lease, renewalIntervalSeconds: LEASE_RENEWAL_INTERVAL_SECONDS }, controlEvents: [] });
    } catch (error) {
      return v1Error(response, 409, "lease_stale", error instanceof Error ? error.message : "The Playback Lease is stale.");
    }
  });

  app.post("/api/v1/playback-leases/:leaseId/takeover", (request, response) => {
    const device = requireClientDevice(request, response);
    if (!device) return;
    const active = playbackLeases.get(request.params.leaseId);
    if (!active || active.state !== "active") {
      return v1Error(response, 404, "lease_not_found", "The active Playback Lease is no longer available.");
    }
    if (request.body?.confirm !== true) {
      return v1Error(response, 400, "takeover_confirmation_required", "Confirm before taking over playback.");
    }
    try {
      const lease = playbackLeases.takeover({
        gameId: active.gameId,
        editionId: active.editionId,
        playerKey: active.playerKey,
        deviceId: device.id,
      });
      playbackGrants.revokeLease(active.id);
      const context = checkpointContextForLease(lease, device);
      if (!context) return v1Error(response, 409, "game_file_changed", "The Game File changed before takeover completed.");
      const grant = playbackGrants.issue(lease.gameId, lease.playerKey, lease.id, device.id);
      catalog.recordPlaySession(lease.gameId, new Date(), lease.playerKey);
      response.setHeader("Cache-Control", "no-store");
      return response.status(201).json(nativeLeasePayload(lease, grant, context, "resume"));
    } catch (error) {
      return v1Error(response, 409, "takeover_failed", error instanceof Error ? error.message : "Takeover could not complete.");
    }
  });

  app.delete("/api/v1/playback-leases/:leaseId", (request, response) => {
    const device = requireClientDevice(request, response);
    if (!device) return;
    const revision = leaseRevisionFor(request);
    if (!revision) return v1Error(response, 428, "lease_revision_required", "The current Playback Lease revision is required.");
    if (!playbackLeases.release(request.params.leaseId, device.id, revision)) {
      return v1Error(response, 409, "lease_stale", "The Playback Lease is stale or unavailable.");
    }
    playbackGrants.revokeLease(request.params.leaseId);
    return response.status(204).send();
  });

  app.post(
    "/api/v1/playback-leases/:leaseId/checkpoints",
    express.raw({ type: "application/octet-stream", limit: "12mb" }),
    async (request, response, next) => {
      try {
        const device = requireClientDevice(request, response);
        if (!device) return;
        const lease = playbackLeases.authorize(request.params.leaseId, device.id);
        if (!lease) return v1Error(response, 409, "lease_unavailable", "This device no longer owns the Playback Lease.");
        const revision = leaseRevisionFor(request);
        if (!revision || revision !== lease.revision) {
          return v1Error(response, 409, "lease_stale", "Refresh the Playback Lease before publishing progress.");
        }
        if (!Buffer.isBuffer(request.body)) {
          return v1Error(response, 415, "checkpoint_bytes_required", "Checkpoint bytes were not understood.");
        }
        const context = checkpointContextForLease(lease, device);
        if (!context) return v1Error(response, 409, "game_file_changed", "The Game File changed before progress was published.");
        const capturedFrame = Number.parseInt(String(request.headers["x-captured-frame"] ?? ""), 10);
        if (!Number.isSafeInteger(capturedFrame) || capturedFrame < 0) {
          return v1Error(response, 400, "captured_frame_invalid", "Checkpoint capture requires a nonnegative frame number.");
        }
        const checkpoint = await checkpointStore.capture(context, request.body, capturedFrame);
        return response.status(201).json({ checkpoint, leaseRevision: lease.revision });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/v1/checkpoints/:checkpointId", async (request, response, next) => {
    try {
      const device = requireClientDevice(request, response);
      if (!device) return;
      const playerKey = v1PlayerKeyFor(request, response);
      if (!playerKey) return;
      const state = await checkpointStore.readStateForProfile(
        request.params.checkpointId,
        playerKey,
        NATIVE_CHECKPOINT_COMPATIBILITY,
      );
      if (!state) return v1Error(response, 404, "checkpoint_not_found", "That compatible Checkpoint is unavailable.");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "application/octet-stream");
      return response.send(state);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/v1/checkpoints/:checkpointId/restore-attempts", (request, response) => {
    const device = requireClientDevice(request, response);
    if (!device) return;
    const playerKey = v1PlayerKeyFor(request, response);
    if (!playerKey) return;
    const outcome = request.body?.outcome === "verified" ? "verified" : request.body?.outcome === "failed" ? "failed" : null;
    if (!outcome) return v1Error(response, 400, "restore_outcome_required", "Provide a verified or failed restore outcome.");
    const recorded = checkpointStore.recordRestoreAttemptForProfile(
      request.params.checkpointId,
      playerKey,
      NATIVE_CHECKPOINT_COMPATIBILITY,
      {
        deviceId: device.id,
        clientVersion: device.appVersion,
        outcome,
        observedFrame: Number.isSafeInteger(request.body?.observedFrame) ? request.body.observedFrame : undefined,
        reason: typeof request.body?.reason === "string" ? request.body.reason : undefined,
      },
    );
    return recorded
      ? response.status(201).json({ recorded: true })
      : v1Error(response, 404, "checkpoint_not_found", "That compatible Checkpoint is unavailable.");
  });

  app.get("/api/player-profiles", (_request, response) => {
    response.json({ profiles: catalog.listPlayerProfiles() });
  });

  app.post("/api/player-profiles", (request, response) => {
    try {
      const profile = catalog.createPlayerProfile(String(request.body?.displayName ?? ""), String(request.body?.avatarKey ?? ""));
      return response.status(201).json({ profile });
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Player Profile could not be created." });
    }
  });

  app.put("/api/player-profiles/:profileKey", (request, response) => {
    try {
      const profile = catalog.updatePlayerIdentity(request.params.profileKey, String(request.body?.displayName ?? ""), String(request.body?.avatarKey ?? ""));
      return response.json({ profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Player Profile could not be updated.";
      return response.status(message === "Player Profile not found." ? 404 : 400).json({ message });
    }
  });

  app.put("/api/player-profiles/:profileKey/preferences", (request, response) => {
    try {
      const profile = catalog.updatePlayerPreferences(request.params.profileKey, String(request.body?.themeKey ?? ""), String(request.body?.accentColor ?? ""));
      return response.json({ profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preferences could not be saved.";
      return response.status(message === "Player Profile not found." ? 404 : 400).json({ message });
    }
  });

  app.put("/api/player-profiles/:profileKey/controller", (request, response) => {
    try {
      const profile = catalog.updatePlayerControllerPreset(request.params.profileKey, String(request.body?.controllerPreset ?? ""));
      return response.json({ profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Controller preference could not be saved.";
      return response.status(message === "Player Profile not found." ? 404 : 400).json({ message });
    }
  });

  app.get("/api/admin/settings", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    response.json(configuration.settings(scanState));
  });

  app.put("/api/admin/library", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    if (activeScan) return response.status(409).json({ message: "Wait for the current Library scan to finish before changing its location." });
    try {
      const library = configuration.updateLibraryRoot(String(request.body?.rootPath ?? ""));
      scanState = { status: "idle", lastScannedAt: library.lastScannedAt, message: null };
      return response.json({ library });
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "ROM Library location could not be saved." });
    }
  });

  app.get("/api/catalog", (request, response) => {
    const games = catalog.listGames(playerKeyFor(request));
    response.json({
      shelf: {
        id: "game-library",
        title: "Game Library",
        games,
      },
      scan: scanState,
      presentation: presentation.catalog(games),
    });
  });

  app.get("/api/admin/presentation", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    response.json(presentation.administration(catalog.listGames(playerKeyFor(request))));
  });

  app.post("/api/admin/collections", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      const collection = presentation.createCollection(request.body as CollectionInput, catalog.listGames(playerKeyFor(request)));
      return response.status(201).json({ collection });
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Collection could not be created." });
    }
  });

  app.put("/api/admin/collections/:collectionId", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      const collection = presentation.updateCollection(request.params.collectionId, request.body as CollectionInput, catalog.listGames(playerKeyFor(request)));
      return response.json({ collection });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Collection could not be updated.";
      return response.status(message === "Collection not found." ? 404 : 400).json({ message });
    }
  });

  app.delete("/api/admin/collections/:collectionId", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      presentation.deleteCollection(request.params.collectionId);
      return response.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Collection could not be removed.";
      return response.status(message === "Collection not found." ? 404 : 400).json({ message });
    }
  });

  app.post("/api/admin/browse-rows", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      const administration = presentation.administration(catalog.listGames(playerKeyFor(request)));
      const row = presentation.createBrowseRow(request.body as BrowseRowInput, new Set(administration.collectionOptions.map((collection) => collection.id)));
      return response.status(201).json({ row });
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Browse Row could not be created." });
    }
  });

  app.put("/api/admin/browse-rows/order", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(String) : [];
      return response.json({ rows: presentation.orderBrowseRows(ids) });
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Browse Rows could not be reordered." });
    }
  });

  app.put("/api/admin/browse-rows/:rowId", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      const administration = presentation.administration(catalog.listGames(playerKeyFor(request)));
      const row = presentation.updateBrowseRow(request.params.rowId, request.body as BrowseRowInput, new Set(administration.collectionOptions.map((collection) => collection.id)));
      return response.json({ row });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browse Row could not be updated.";
      return response.status(message === "Browse Row not found." ? 404 : 400).json({ message });
    }
  });

  app.delete("/api/admin/browse-rows/:rowId", (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      presentation.deleteBrowseRow(request.params.rowId);
      return response.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browse Row could not be removed.";
      return response.status(message === "Browse Row not found." ? 404 : 400).json({ message });
    }
  });

  app.post("/api/admin/rescan", async (request, response) => {
    if (!requireAdministrator(request, response)) return;
    try {
      const result = await rescan();
      response.json({ ...result, scannedAt: scanState.lastScannedAt });
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : "Library scan failed." });
    }
  });

  app.put("/api/admin/games/:gameId/metadata", async (request, response) => {
    try {
      if (!requireAdministrator(request, response)) return;
      const input = request.body as MetadataCorrectionInput;
      const game = catalog.updateMetadataCorrection(request.params.gameId, input);
      await artworkStore.invalidate(request.params.gameId);
      return response.json({ game });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metadata Match could not be corrected.";
      return response.status(message === "Game not found." ? 404 : 400).json({ message });
    }
  });

  app.delete("/api/admin/games/:gameId/metadata", async (request, response) => {
    try {
      if (!requireAdministrator(request, response)) return;
      const game = catalog.clearMetadataCorrection(request.params.gameId);
      await artworkStore.invalidate(request.params.gameId);
      return response.json({ game });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metadata Match could not be reset.";
      return response.status(message === "Game not found." ? 404 : 400).json({ message });
    }
  });

  app.get("/api/artwork/:gameId", async (request, response) => {
    try {
      const artwork = await artworkStore.get(request.params.gameId);
      response.setHeader("Cache-Control", "public, max-age=86400");
      response.setHeader("Content-Type", artwork.contentType);
      return response.send(artwork.data);
    } catch {
      const fallback = catalog.getArtworkSource(request.params.gameId);
      return fallback ? response.redirect(307, fallback) : response.status(404).send();
    }
  });

  app.get("/api/games/:gameId", (request, response) => {
    const game = catalog.getGame(request.params.gameId, playerKeyFor(request));
    if (!game) return response.status(404).json({ message: "That game is no longer on this shelf." });
    return response.json({ game });
  });

  app.post("/api/games/:gameId/launch", (request, response) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      const playerKey = playerKeyFor(request);
      const manifest = playbackResolver.resolve(request.params.gameId, Date.now(), playerKey);
      const savedStateId = typeof request.body?.savedStateId === "string" ? request.body.savedStateId : "";
      if (savedStateId) {
        const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKey);
        const savedState = context ? savedStateStore.find(savedStateId, context) : null;
        if (!savedState) return response.status(404).json({ message: "That saved state is unavailable or incompatible with this game." });
        const profileQuery = `profile=${encodeURIComponent(playerKey)}`;
        manifest.resumePlan.checkpoints = [{
          id: savedState.id,
          generation: 1,
          status: "verified",
          capturedFrame: savedState.capturedFrame,
          stateUrl: `/api/games/${request.params.gameId}/saved-states/${savedState.id}/state?${profileQuery}`,
          verifyUrl: `/api/games/${request.params.gameId}/saved-states/${savedState.id}/restored?${profileQuery}`,
          rejectUrl: `/api/games/${request.params.gameId}/saved-states/${savedState.id}/restored?${profileQuery}`,
          preserveOnFailure: true,
        }];
      }
      catalog.recordPlaySession(request.params.gameId, new Date(), playerKey);
      return response.json({ manifest });
    } catch (error) {
      const message = error instanceof Error ? error.message : "This game could not be prepared.";
      return response.status(message === "Game not found." ? 404 : 409).json({ message });
    }
  });

  app.get("/api/games/:gameId/saved-states", (request, response) => {
    const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
    if (!context) return response.status(404).json({ message: "That game is no longer on this shelf." });
    return response.json({ savedStates: savedStateStore.list(context) });
  });

  app.post(
    "/api/games/:gameId/saved-states",
    express.raw({ type: "application/octet-stream", limit: "12mb" }),
    async (request, response, next) => {
      try {
        const playerKey = playerKeyFor(request);
        const sessionId = typeof request.query.session === "string" ? request.query.session : "";
        const context = playbackResolver.resolveCheckpointSession(sessionId, request.params.gameId, playerKey);
        if (!context) return response.status(409).json({ message: "This playback session can no longer create a saved state." });
        if (!Buffer.isBuffer(request.body)) return response.status(415).json({ message: "Saved-state data was not understood." });
        const capturedFrame = Number.parseInt(String(request.headers["x-captured-frame"] ?? ""), 10);
        const savedState = await savedStateStore.create(context, request.body, capturedFrame);
        return response.status(201).json({ savedState });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The saved state could not be created.";
        if (message.startsWith("Delete a saved state")) return response.status(409).json({ message });
        return next(error);
      }
    },
  );

  app.put(
    "/api/games/:gameId/saved-states/:savedStateId/thumbnail",
    express.raw({ type: ["image/webp", "image/png", "image/jpeg"], limit: "2mb" }),
    async (request, response, next) => {
      try {
        const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
        if (!context) return response.status(404).json({ message: "That game is unavailable." });
        if (!Buffer.isBuffer(request.body) || !request.body.byteLength) return response.status(415).json({ message: "Thumbnail data was not understood." });
        const contentType = String(request.headers["content-type"] ?? "").split(";")[0];
        const savedState = await savedStateStore.attachThumbnail(request.params.savedStateId, context, request.body, contentType);
        return response.json({ savedState });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/games/:gameId/saved-states/:savedStateId/thumbnail", async (request, response, next) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      const thumbnail = context ? await savedStateStore.readThumbnail(request.params.savedStateId, context) : null;
      if (!thumbnail) return response.status(404).send();
      response.setHeader("Cache-Control", "private, max-age=86400");
      response.setHeader("Content-Type", thumbnail.contentType);
      return response.send(thumbnail.data);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/games/:gameId/saved-states/:savedStateId/state", async (request, response, next) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      const state = context ? await savedStateStore.readState(request.params.savedStateId, context) : null;
      if (!state) return response.status(404).json({ message: "That saved state is unavailable." });
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "application/octet-stream");
      return response.send(state);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/games/:gameId/saved-states/:savedStateId/restored", (request, response) => {
    const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
    if (!context || !savedStateStore.find(request.params.savedStateId, context)) {
      return response.status(404).json({ message: "That saved state is unavailable." });
    }
    // Only fork automatic progression after the emulator has proven that the
    // selected durable state loads and advances. A failed load leaves the
    // player's current Continue Playing lineage untouched.
    checkpointStore.startNewLineage(context);
    return response.status(204).send();
  });

  app.patch("/api/games/:gameId/saved-states/:savedStateId", (request, response) => {
    const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
    const savedState = context ? savedStateStore.rename(request.params.savedStateId, context, String(request.body?.label ?? "")) : null;
    return savedState ? response.json({ savedState }) : response.status(404).json({ message: "That saved state is unavailable." });
  });

  app.delete("/api/games/:gameId/saved-states/:savedStateId", async (request, response, next) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      const deleted = context ? await savedStateStore.delete(request.params.savedStateId, context) : false;
      return deleted ? response.status(204).send() : response.status(404).json({ message: "That saved state is unavailable." });
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/games/:gameId/favorite", (request, response) => {
    if (typeof request.body?.favorite !== "boolean") {
      return response.status(400).json({ message: "Choose whether this game belongs in Favorites." });
    }
    try {
      return response.json({ game: catalog.setFavorite(request.params.gameId, request.body.favorite, new Date(), playerKeyFor(request)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "That favorite could not be updated.";
      return response.status(message === "Game not found." ? 404 : 409).json({ message });
    }
  });

  app.delete("/api/games/:gameId/continue-playing", (request, response) => {
    try {
      const game = catalog.dismissContinuePlaying(request.params.gameId, new Date(), playerKeyFor(request));
      return response.json({ game });
    } catch (error) {
      const message = error instanceof Error ? error.message : "That game could not be removed from Continue Playing.";
      return response.status(message === "Game not found." ? 404 : 409).json({ message });
    }
  });

  app.get("/api/playback/files/:sessionId", (request, response) => {
    const absolutePath = playbackResolver.resolveSession(request.params.sessionId);
    if (!absolutePath) {
      return response.status(404).json({ message: "This launch link expired. Return to the game and press Play again." });
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/octet-stream");
    const extension = path.extname(absolutePath).toLocaleLowerCase("en-US");
    const safeExtension = [".nes", ".sfc", ".smc", ".snes", ".a26", ".bin"].includes(extension) ? extension : ".rom";
    response.setHeader("Content-Disposition", `inline; filename="game${safeExtension}"`);
    return response.sendFile(absolutePath);
  });

  app.post(
    "/api/games/:gameId/checkpoints",
    express.raw({ type: "application/octet-stream", limit: "12mb" }),
    async (request, response, next) => {
      try {
        const playerKey = playerKeyFor(request);
        const sessionId = typeof request.query.session === "string" ? request.query.session : "";
        const context = playbackResolver.resolveCheckpointSession(sessionId, request.params.gameId, playerKey);
        if (!context) return response.status(409).json({ message: "This playback session can no longer create a checkpoint. Your browser save remains available." });
        if (!Buffer.isBuffer(request.body)) {
          return response.status(415).json({ message: "Checkpoint data was not understood." });
        }
        const capturedFrame = Number.parseInt(String(request.headers["x-captured-frame"] ?? ""), 10);
        const checkpoint = await checkpointStore.capture(context, request.body, capturedFrame);
        return response.status(201).json({ checkpoint });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/api/games/:gameId/checkpoints/:checkpointId/state", async (request, response, next) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      const state = context ? await checkpointStore.readState(request.params.checkpointId, context) : null;
      if (!state) return response.status(404).json({ message: "That checkpoint is no longer available." });
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "application/octet-stream");
      return response.send(state);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/games/:gameId/checkpoints/:checkpointId/verified", (request, response) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      if (!context) return response.status(404).json({ message: "That game is no longer on this shelf." });
      const checkpoint = checkpointStore.verify(request.params.checkpointId, context, Number(request.body?.observedFrame));
      return response.json({ checkpoint });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkpoint could not be verified.";
      return response.status(message === "Checkpoint is unavailable." ? 404 : 409).json({ message });
    }
  });

  app.post("/api/games/:gameId/checkpoints/:checkpointId/failed", async (request, response, next) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      if (!context) return response.status(404).json({ message: "That game is no longer on this shelf." });
      const rejected = await checkpointStore.reject(
        request.params.checkpointId,
        context,
        String(request.body?.reason ?? "Checkpoint could not be restored."),
      );
      return rejected ? response.status(204).send() : response.status(404).json({ message: "Checkpoint is unavailable." });
    } catch (error) {
      return next(error);
    }
  });

  // Compatibility read for bookmarks or cached clients. New manifests use a
  // version-specific checkpoint URL so a later capture cannot change the bytes.
  app.get("/api/saves/:gameId/state", async (request, response, next) => {
    try {
      const context = playbackResolver.resolveCheckpointContext(request.params.gameId, playerKeyFor(request));
      const checkpoint = context ? checkpointStore.listRestorable(context)[0] : null;
      const state = context && checkpoint ? await checkpointStore.readState(checkpoint.id, context) : null;
      if (!state) return response.status(404).json({ message: "No saved progress is available yet." });
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "application/octet-stream");
      return response.send(state);
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/saves/:gameId/state", async (request, response, next) => {
    try {
      const playerKey = playerKeyFor(request);
      if (!catalog.getGame(request.params.gameId, playerKey)) {
        return response.status(404).json({ message: "That game is no longer in your library." });
      }
      await checkpointStore.deleteGame(request.params.gameId, playerKey);
      return response.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.use("/api/v1", (_request, response) => {
    v1Error(response, 404, "route_not_found", "That native API route does not exist.");
  });

  if (existsSync(config.clientDir)) {
    app.use(express.static(config.clientDir, { index: false, maxAge: "1h" }));
    app.use((request, response, next) => {
      if (request.method !== "GET" || !request.accepts("html")) return next();
      return response.sendFile(path.join(config.clientDir, "index.html"));
    });
  } else if (existsSync(config.publicDir)) {
    app.use("/emulatorjs", express.static(path.join(config.publicDir, "emulatorjs")));
  }

  app.use((_request, response) => {
    response.status(404).json({ message: "Not found." });
  });
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    if (request.path.startsWith("/api/v1/")) {
      const tooLarge = typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
      return v1Error(
        response,
        tooLarge ? 413 : 500,
        tooLarge ? "request_too_large" : "internal_error",
        tooLarge ? "That request is larger than the server accepts." : "The Portal Server hit a snag. Nothing in your library was changed.",
        !tooLarge,
      );
    }
    response.status(500).json({ message: "The portal hit a snag. Nothing in your library was changed." });
  });

  return {
    app,
    database,
    catalog,
    configuration,
    presentation,
    identity: identityStore,
    devicePairing,
    playbackLeases,
    rescan,
    close: () => database.close(),
  };
}

function v1Error(
  response: Response,
  status: number,
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {},
): Response {
  return response.status(status).json({ error: { code, message, retryable, details } });
}

function leaseRevisionFor(request: Request): number | null {
  const header = request.headers["x-lease-revision"];
  const bodyRevision = request.body && !Buffer.isBuffer(request.body) ? request.body.revision : undefined;
  const revision = Number(Array.isArray(header) ? header[0] : header ?? bodyRevision);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function versionedJson(request: Request, response: Response, body: object): Response {
  const serialized = JSON.stringify(body);
  const etag = `\"${createHash("sha256").update(serialized).digest("base64url")}\"`;
  response.setHeader("ETag", etag);
  response.setHeader("Cache-Control", "private, no-cache");
  return request.headers["if-none-match"] === etag
    ? response.status(304).send()
    : response.type("application/json").send(serialized);
}
