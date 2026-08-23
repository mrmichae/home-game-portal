import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { AppConfig } from "./config.js";
import { CatalogRepository, DEFAULT_PLAYER_KEY, type ScanCommitResult } from "./catalog-repository.js";
import { openDatabase, type PortalDatabase } from "./database.js";
import { scanNesLibrary } from "./library-scanner.js";
import { PlaybackResolver } from "./playback-resolver.js";
import { VersionedCheckpointStore } from "./checkpoint-store.js";
import { ArtworkStore } from "./artwork-store.js";
import { PortalConfiguration } from "./portal-configuration.js";
import { PortalPresentation } from "./portal-presentation.js";
import type { BrowseRowInput, CollectionInput, MetadataCorrectionInput, ScanStatus } from "../domain/types.js";
import { RetronianMetadataProvider } from "./metadata-provider.js";

export interface PortalApplication {
  app: Express;
  database: PortalDatabase;
  catalog: CatalogRepository;
  configuration: PortalConfiguration;
  presentation: PortalPresentation;
  rescan: () => Promise<ScanCommitResult>;
  close: () => void;
}

interface PortalApplicationDependencies {
  metadataProvider?: Pick<RetronianMetadataProvider, "match">;
}

export function createPortalApplication(config: AppConfig, dependencies: PortalApplicationDependencies = {}): PortalApplication {
  const database = openDatabase(config.dataDir, config.migrationsDir);
  const catalog = new CatalogRepository(database);
  const configuration = new PortalConfiguration(catalog, config.defaultLibraryRoot);
  configuration.initialize();
  const presentation = new PortalPresentation(database);
  const checkpointStore = new VersionedCheckpointStore(config.savesDir, database);
  const playbackResolver = new PlaybackResolver(catalog, checkpointStore);
  const artworkStore = new ArtworkStore(config.artworkDir, catalog);
  const metadataProvider = dependencies.metadataProvider ?? new RetronianMetadataProvider(path.join(config.dataDir, "metadata"));
  const app = express();
  let scanState: ScanStatus = { status: "idle", lastScannedAt: catalog.getLibrarySource().lastScannedAt, message: null };
  let activeScan: Promise<ScanCommitResult> | null = null;

  const rescan = (): Promise<ScanCommitResult> => {
    if (activeScan) return activeScan;
    scanState = { ...scanState, status: "scanning", message: null };
    const libraryRoot = catalog.getLibraryRoot();
    activeScan = scanNesLibrary(libraryRoot)
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
        id: "nintendo-entertainment-system",
        title: "Nintendo Entertainment System",
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
      catalog.recordPlaySession(request.params.gameId, new Date(), playerKey);
      return response.json({ manifest });
    } catch (error) {
      const message = error instanceof Error ? error.message : "This game could not be prepared.";
      return response.status(message === "Game not found." ? 404 : 409).json({ message });
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
    response.setHeader("Content-Disposition", 'inline; filename="game.nes"');
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
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ message: "The portal hit a snag. Nothing in your library was changed." });
  });

  return {
    app,
    database,
    catalog,
    configuration,
    presentation,
    rescan,
    close: () => database.close(),
  };
}
