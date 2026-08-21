import { createHash } from "node:crypto";
import type {
  DiscoveredGameFile,
  GameDetail,
  GameSummary,
  MetadataCorrectionInput,
  PlayerProfile,
  ControllerPresetKey,
  EmulatorProfile,
  PlatformKey,
} from "../domain/types.js";
import type { PortalDatabase } from "./database.js";
import { hasCuratedMetadata, metadataForGame } from "./nes-metadata.js";
import { isProfileAvatarKey, profileAvatarChoice, type ProfileAvatarKey } from "../domain/profile-avatars.js";
import { platforms } from "../domain/platforms.js";

const SOURCE_ID = 1;
export const DEFAULT_PLAYER_KEY = "household";
const THEME_KEYS = new Set(["current", "retro-80s", "nes", "snes", "genesis", "n64", "atari"]);
const CONTROLLER_PRESETS = new Set<ControllerPresetKey>(["keyboard", "joy-con", "switch-pro", "apple-tv-remote"]);

interface GameRow {
  id: string;
  display_name: string;
  added_at: string;
  byte_size: number;
  edition_id: string;
  platform_key: PlatformKey;
  relative_path: string;
  save_updated_at: string | null;
  is_favorite: number;
  last_played_at: string | null;
  correction_game_id: string | null;
  corrected_display_name: string | null;
  corrected_release_year: number | null;
  corrected_description: string | null;
  corrected_genres_json: string | null;
  corrected_series_name: string | null;
  corrected_cover_url: string | null;
  corrected_updated_at: string | null;
}

interface FileRow {
  relative_path: string;
}

export interface ScanCommitResult {
  discovered: number;
  added: number;
}

export interface LibrarySourceRecord {
  rootPath: string;
  platformKey: PlatformKey;
  lastScannedAt: string | null;
}

export class CatalogRepository {
  constructor(private readonly database: PortalDatabase) {}

  ensureLibrarySource(rootPath: string): void {
    this.database
      .prepare(
        `INSERT INTO library_sources(id, name, root_path, platform_key)
         VALUES (?, ?, ?, 'nes')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(SOURCE_ID, "NES Library", rootPath);
  }

  getLibrarySource(): LibrarySourceRecord {
    const row = this.database
      .prepare("SELECT root_path, platform_key, last_scanned_at FROM library_sources WHERE id = ?")
      .get(SOURCE_ID) as unknown as { root_path: string; platform_key: PlatformKey; last_scanned_at: string | null } | undefined;
    if (!row) throw new Error("Library Source is not configured.");
    return { rootPath: row.root_path, platformKey: row.platform_key, lastScannedAt: row.last_scanned_at };
  }

  updateLibrarySourceRoot(rootPath: string): void {
    const result = this.database
      .prepare("UPDATE library_sources SET root_path = ? WHERE id = ?")
      .run(rootPath, SOURCE_ID);
    if (result.changes === 0) throw new Error("Library Source is not configured.");
  }

  commitScan(files: DiscoveredGameFile[], scannedAt = new Date()): ScanCommitResult {
    const now = scannedAt.toISOString();
    const existingStatement = this.database.prepare(
      "SELECT 1 FROM game_files WHERE library_source_id = ? AND relative_path = ?",
    );
    const upsertGame = this.database.prepare(`
      INSERT INTO games(id, display_name, added_at, last_seen_at, active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at,
        active = 1
    `);
    const upsertEdition = this.database.prepare(`
      INSERT INTO editions(id, game_id, platform_key, preferred, active)
      VALUES (?, ?, 'nes', 1, 1)
      ON CONFLICT(id) DO UPDATE SET active = 1
    `);
    const upsertFile = this.database.prepare(`
      INSERT INTO game_files(
        id, edition_id, library_source_id, relative_path, content_hash,
        byte_size, modified_at_ms, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(library_source_id, relative_path) DO UPDATE SET
        edition_id = excluded.edition_id,
        content_hash = excluded.content_hash,
        byte_size = excluded.byte_size,
        modified_at_ms = excluded.modified_at_ms,
        active = 1
    `);

    let added = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("UPDATE game_files SET active = 0 WHERE library_source_id = ?")
        .run(SOURCE_ID);

      for (const file of files) {
        if (!existingStatement.get(SOURCE_ID, file.relativePath)) added += 1;
        const gameId = stableId("game", file.contentHash);
        const editionId = stableId("edition", file.contentHash);
        const fileId = stableId("file", `${SOURCE_ID}\0${file.relativePath}`);
        upsertGame.run(gameId, file.displayName, now, now);
        upsertEdition.run(editionId, gameId);
        upsertFile.run(
          fileId,
          editionId,
          SOURCE_ID,
          file.relativePath,
          file.contentHash,
          file.byteSize,
          file.modifiedAtMs,
        );
      }

      this.database.exec(`
        UPDATE editions
        SET active = CASE WHEN EXISTS (
          SELECT 1 FROM game_files
          WHERE game_files.edition_id = editions.id AND game_files.active = 1
        ) THEN 1 ELSE 0 END;

        UPDATE games
        SET active = CASE WHEN EXISTS (
          SELECT 1 FROM editions
          WHERE editions.game_id = games.id AND editions.active = 1
        ) THEN 1 ELSE 0 END;
      `);
      this.database
        .prepare("UPDATE library_sources SET last_scanned_at = ? WHERE id = ?")
        .run(now, SOURCE_ID);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return { discovered: files.length, added };
  }

  listGames(playerKey = DEFAULT_PLAYER_KEY): GameSummary[] {
    const rows = this.database
      .prepare(
        `SELECT
           games.id,
           games.display_name,
           games.added_at,
           editions.id AS edition_id,
           editions.platform_key,
           MIN(game_files.relative_path) AS relative_path,
           MIN(game_files.byte_size) AS byte_size,
           saves.updated_at AS save_updated_at,
           EXISTS (
             SELECT 1 FROM favorites
             WHERE favorites.game_id = games.id AND favorites.player_key = ?
           ) AS is_favorite,
           (
             SELECT MAX(play_sessions.started_at)
             FROM play_sessions
             JOIN editions AS played_editions ON played_editions.id = play_sessions.edition_id
             WHERE played_editions.game_id = games.id AND play_sessions.player_key = ?
           ) AS last_played_at
           , metadata_corrections.game_id AS correction_game_id
           , metadata_corrections.display_name AS corrected_display_name
           , metadata_corrections.release_year AS corrected_release_year
           , metadata_corrections.description AS corrected_description
           , metadata_corrections.genres_json AS corrected_genres_json
           , metadata_corrections.series_name AS corrected_series_name
           , metadata_corrections.cover_url AS corrected_cover_url
           , metadata_corrections.updated_at AS corrected_updated_at
         FROM games
         JOIN editions ON editions.game_id = games.id AND editions.active = 1
         JOIN game_files ON game_files.edition_id = editions.id AND game_files.active = 1
         LEFT JOIN saves ON saves.edition_id = editions.id
           AND saves.player_key = ? AND saves.kind = 'state'
         LEFT JOIN metadata_corrections ON metadata_corrections.game_id = games.id
         WHERE games.active = 1
         GROUP BY games.id, editions.id, saves.updated_at
         ORDER BY games.display_name COLLATE NOCASE`,
      )
      .all(playerKey, playerKey, playerKey) as unknown as GameRow[];
    return rows.map(toGameSummary);
  }

  getGame(gameId: string, playerKey = DEFAULT_PLAYER_KEY): GameDetail | null {
    const row = this.database
      .prepare(
        `SELECT
           games.id,
           games.display_name,
           games.added_at,
           editions.id AS edition_id,
           editions.platform_key,
           MIN(game_files.relative_path) AS relative_path,
           MIN(game_files.byte_size) AS byte_size,
           saves.updated_at AS save_updated_at,
           EXISTS (
             SELECT 1 FROM favorites
             WHERE favorites.game_id = games.id AND favorites.player_key = ?
           ) AS is_favorite,
           (
             SELECT MAX(play_sessions.started_at)
             FROM play_sessions
             JOIN editions AS played_editions ON played_editions.id = play_sessions.edition_id
             WHERE played_editions.game_id = games.id AND play_sessions.player_key = ?
           ) AS last_played_at
           , metadata_corrections.game_id AS correction_game_id
           , metadata_corrections.display_name AS corrected_display_name
           , metadata_corrections.release_year AS corrected_release_year
           , metadata_corrections.description AS corrected_description
           , metadata_corrections.genres_json AS corrected_genres_json
           , metadata_corrections.series_name AS corrected_series_name
           , metadata_corrections.cover_url AS corrected_cover_url
           , metadata_corrections.updated_at AS corrected_updated_at
         FROM games
         JOIN editions ON editions.game_id = games.id AND editions.active = 1
         JOIN game_files ON game_files.edition_id = editions.id AND game_files.active = 1
         LEFT JOIN saves ON saves.edition_id = editions.id
           AND saves.player_key = ? AND saves.kind = 'state'
         LEFT JOIN metadata_corrections ON metadata_corrections.game_id = games.id
         WHERE games.id = ? AND games.active = 1
         GROUP BY games.id, editions.id, saves.updated_at`,
      )
      .get(playerKey, playerKey, playerKey, gameId) as unknown as GameRow | undefined;
    if (!row) return null;
    return { ...toGameSummary(row), editionId: row.edition_id, sourceDisplayName: row.display_name, artworkSourceUrl: row.corrected_cover_url || metadataForGame(row.display_name, row.relative_path).coverUrl };
  }

  getPreferredGameFile(gameId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT game_files.relative_path
         FROM games
         JOIN editions ON editions.game_id = games.id
           AND editions.preferred = 1 AND editions.active = 1
         JOIN game_files ON game_files.edition_id = editions.id
           AND game_files.active = 1
         WHERE games.id = ? AND games.active = 1
         ORDER BY game_files.relative_path
         LIMIT 1`,
      )
      .get(gameId) as unknown as FileRow | undefined;
    return row?.relative_path ?? null;
  }

  getLibraryRoot(): string {
    return this.getLibrarySource().rootPath;
  }

  listEmulatorProfiles(): EmulatorProfile[] {
    const rows = this.database
      .prepare(
        `SELECT platform_key, platform_name, capability_key, policy_key, enabled, web_adapter_key, web_core_key
         FROM emulator_profiles ORDER BY CASE platform_key WHEN 'nes' THEN 1 WHEN 'snes' THEN 2 ELSE 3 END, platform_name`,
      )
      .all() as unknown as EmulatorProfileRow[];
    return rows.map(toEmulatorProfile);
  }

  getEmulatorProfile(platformKey: PlatformKey): EmulatorProfile | null {
    const row = this.database
      .prepare(
        `SELECT platform_key, platform_name, capability_key, policy_key, enabled, web_adapter_key, web_core_key
         FROM emulator_profiles WHERE platform_key = ?`,
      )
      .get(platformKey) as unknown as EmulatorProfileRow | undefined;
    return row ? toEmulatorProfile(row) : null;
  }

  getSaveRecord(gameId: string, playerKey = DEFAULT_PLAYER_KEY): { relativePath: string; updatedAt: string } | null {
    const row = this.database
      .prepare(
        `SELECT saves.relative_path, saves.updated_at
         FROM saves
         JOIN editions ON editions.id = saves.edition_id
         WHERE editions.game_id = ? AND saves.player_key = ? AND saves.kind = 'state'`,
      )
      .get(gameId, playerKey) as unknown as
      | { relative_path: string; updated_at: string }
      | undefined;
    return row ? { relativePath: row.relative_path, updatedAt: row.updated_at } : null;
  }

  recordSave(gameId: string, relativePath: string, byteSize: number, savedAt: Date, playerKey = DEFAULT_PLAYER_KEY): void {
    const game = this.getGame(gameId, playerKey);
    if (!game) throw new Error("Game not found.");
    this.database
      .prepare(
        `INSERT INTO saves(edition_id, player_key, kind, relative_path, byte_size, updated_at)
         VALUES (?, ?, 'state', ?, ?, ?)
         ON CONFLICT(edition_id, player_key, kind) DO UPDATE SET
           relative_path = excluded.relative_path,
           byte_size = excluded.byte_size,
           updated_at = excluded.updated_at`,
      )
      .run(game.editionId, playerKey, relativePath, byteSize, savedAt.toISOString());
  }

  deleteSaveRecord(gameId: string, playerKey = DEFAULT_PLAYER_KEY): void {
    const game = this.getGame(gameId, playerKey);
    if (!game) throw new Error("Game not found.");
    this.database
      .prepare("DELETE FROM saves WHERE edition_id = ? AND player_key = ? AND kind = 'state'")
      .run(game.editionId, playerKey);
  }

  setFavorite(gameId: string, favorite: boolean, changedAt = new Date(), playerKey = DEFAULT_PLAYER_KEY): GameDetail {
    const game = this.getGame(gameId, playerKey);
    if (!game) throw new Error("Game not found.");
    if (favorite) {
      this.database
        .prepare(
          `INSERT INTO favorites(game_id, player_key, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT(game_id, player_key) DO NOTHING`,
        )
        .run(gameId, playerKey, changedAt.toISOString());
    } else {
      this.database
        .prepare("DELETE FROM favorites WHERE game_id = ? AND player_key = ?")
        .run(gameId, playerKey);
    }
    return this.getGame(gameId, playerKey)!;
  }

  recordPlaySession(gameId: string, startedAt = new Date(), playerKey = DEFAULT_PLAYER_KEY): void {
    const game = this.getGame(gameId, playerKey);
    if (!game) throw new Error("Game not found.");
    this.database
      .prepare(
        `INSERT INTO play_sessions(edition_id, player_key, started_at)
         VALUES (?, ?, ?)`,
      )
      .run(game.editionId, playerKey, startedAt.toISOString());
  }

  listPlayerProfiles(): PlayerProfile[] {
    const rows = this.database
      .prepare(
        `SELECT profile_key, display_name, is_administrator, avatar_key, avatar_color, theme_key, accent_color, controller_preset
         FROM player_profiles ORDER BY created_at, display_name COLLATE NOCASE`,
      )
      .all() as unknown as PlayerProfileRow[];
    return rows.map(toPlayerProfile);
  }

  getPlayerProfile(playerKey: string): PlayerProfile | null {
    const row = this.database
      .prepare(
        `SELECT profile_key, display_name, is_administrator, avatar_key, avatar_color, theme_key, accent_color, controller_preset
         FROM player_profiles WHERE profile_key = ?`,
      )
      .get(playerKey) as unknown as PlayerProfileRow | undefined;
    return row ? toPlayerProfile(row) : null;
  }

  createPlayerProfile(displayName: string, avatarKey: string, createdAt = new Date()): PlayerProfile {
    const name = displayName.trim();
    if (!name || name.length > 32) throw new Error("Profile name must be between 1 and 32 characters.");
    if (!isProfileAvatarKey(avatarKey)) throw new Error("Choose one of the available profile avatars.");
    const avatar = profileAvatarChoice(avatarKey);
    const profileKey = `player-${stableId("profile", `${name}\0${createdAt.toISOString()}`)}`;
    this.database
      .prepare(
        `INSERT INTO player_profiles(profile_key, display_name, is_administrator, created_at, avatar_key, avatar_color)
         VALUES (?, ?, 0, ?, ?, ?)`,
      )
      .run(profileKey, name, createdAt.toISOString(), avatar.key, avatar.color);
    return this.getPlayerProfile(profileKey)!;
  }

  updatePlayerIdentity(playerKey: string, displayName: string, avatarKey: string): PlayerProfile {
    const name = displayName.trim();
    if (!this.getPlayerProfile(playerKey)) throw new Error("Player Profile not found.");
    if (!name || name.length > 32) throw new Error("Profile name must be between 1 and 32 characters.");
    if (!isProfileAvatarKey(avatarKey)) throw new Error("Choose one of the available profile avatars.");
    const avatar = profileAvatarChoice(avatarKey);
    this.database
      .prepare("UPDATE player_profiles SET display_name = ?, avatar_key = ?, avatar_color = ? WHERE profile_key = ?")
      .run(name, avatar.key, avatar.color, playerKey);
    return this.getPlayerProfile(playerKey)!;
  }

  updatePlayerPreferences(playerKey: string, themeKey: string, accentColor: string): PlayerProfile {
    if (!this.getPlayerProfile(playerKey)) throw new Error("Player Profile not found.");
    if (!THEME_KEYS.has(themeKey)) throw new Error("Theme is invalid.");
    if (!/^#[0-9a-f]{6}$/i.test(accentColor)) throw new Error("Accent color is invalid.");
    this.database
      .prepare("UPDATE player_profiles SET theme_key = ?, accent_color = ? WHERE profile_key = ?")
      .run(themeKey, accentColor, playerKey);
    return this.getPlayerProfile(playerKey)!;
  }

  updatePlayerControllerPreset(playerKey: string, controllerPreset: string): PlayerProfile {
    if (!this.getPlayerProfile(playerKey)) throw new Error("Player Profile not found.");
    if (!CONTROLLER_PRESETS.has(controllerPreset as ControllerPresetKey)) throw new Error("Controller preset is invalid.");
    this.database
      .prepare("UPDATE player_profiles SET controller_preset = ? WHERE profile_key = ?")
      .run(controllerPreset, playerKey);
    return this.getPlayerProfile(playerKey)!;
  }

  updateMetadataCorrection(gameId: string, input: MetadataCorrectionInput, updatedAt = new Date()): GameDetail {
    if (!this.getGame(gameId)) throw new Error("Game not found.");
    const displayName = input.displayName.trim();
    const description = input.description.trim();
    const genres = input.genres.map((genre) => genre.trim()).filter(Boolean).slice(0, 8);
    const series = input.series?.trim() || null;
    const coverUrl = input.coverUrl?.trim() || null;
    if (!displayName || displayName.length > 120) throw new Error("Display name is required.");
    if (!Number.isInteger(input.releaseYear) || input.releaseYear < 1970 || input.releaseYear > 2100) throw new Error("Release year is invalid.");
    if (!description || description.length > 600) throw new Error("Description is required.");
    if (genres.length === 0) throw new Error("Add at least one genre.");
    if (coverUrl && !/^https:\/\//i.test(coverUrl)) throw new Error("Artwork URL must use HTTPS.");
    this.database
      .prepare(
        `INSERT INTO metadata_corrections(game_id, display_name, release_year, description, genres_json, series_name, cover_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id) DO UPDATE SET
           display_name = excluded.display_name,
           release_year = excluded.release_year,
           description = excluded.description,
           genres_json = excluded.genres_json,
           series_name = excluded.series_name,
           cover_url = excluded.cover_url,
           updated_at = excluded.updated_at`,
      )
      .run(gameId, displayName, input.releaseYear, description, JSON.stringify(genres), series, coverUrl, updatedAt.toISOString());
    return this.getGame(gameId)!;
  }

  clearMetadataCorrection(gameId: string): GameDetail {
    if (!this.getGame(gameId)) throw new Error("Game not found.");
    this.database.prepare("DELETE FROM metadata_corrections WHERE game_id = ?").run(gameId);
    return this.getGame(gameId)!;
  }

  getArtworkSource(gameId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT games.display_name, MIN(game_files.relative_path) AS relative_path, metadata_corrections.cover_url
         FROM games
         JOIN editions ON editions.game_id = games.id AND editions.active = 1
         JOIN game_files ON game_files.edition_id = editions.id AND game_files.active = 1
         LEFT JOIN metadata_corrections ON metadata_corrections.game_id = games.id
         WHERE games.id = ? AND games.active = 1
         GROUP BY games.id`,
      )
      .get(gameId) as unknown as { display_name: string; relative_path: string; cover_url: string | null } | undefined;
    if (!row) return null;
    return row.cover_url || metadataForGame(row.display_name, row.relative_path).coverUrl;
  }
}

function stableId(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}\0${value}`).digest("hex").slice(0, 24);
}

function toGameSummary(row: GameRow): GameSummary {
  const gameMetadata = metadataForGame(row.display_name, row.relative_path);
  const correctedGenres = parseGenres(row.corrected_genres_json);
  return {
    id: row.id,
    displayName: row.corrected_display_name ?? row.display_name,
    platform: row.platform_key,
    platformName: platforms[row.platform_key].displayName,
    addedAt: row.added_at,
    byteSize: row.byte_size,
    ...gameMetadata,
    releaseYear: row.corrected_release_year ?? gameMetadata.releaseYear,
    description: row.corrected_description ?? gameMetadata.description,
    genres: correctedGenres ?? gameMetadata.genres,
    series: row.correction_game_id ? row.corrected_series_name : gameMetadata.series,
    coverUrl: `/api/artwork/${row.id}?v=${encodeURIComponent(row.corrected_updated_at ?? "source")}`,
    hasServerSave: row.save_updated_at !== null,
    saveUpdatedAt: row.save_updated_at,
    isFavorite: row.is_favorite === 1,
    lastPlayedAt: row.last_played_at,
    metadataStatus: row.correction_game_id ? "corrected" : hasCuratedMetadata(row.display_name) ? "curated" : "filename",
  };
}

function parseGenres(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

interface PlayerProfileRow {
  profile_key: string;
  display_name: string;
  is_administrator: number;
  avatar_key: string;
  avatar_color: string;
  theme_key: string;
  accent_color: string;
  controller_preset: string;
}

interface EmulatorProfileRow {
  platform_key: PlatformKey;
  platform_name: string;
  capability_key: string;
  policy_key: "platform-default";
  enabled: number;
  web_adapter_key: string | null;
  web_core_key: string | null;
}

function toEmulatorProfile(row: EmulatorProfileRow): EmulatorProfile {
  return {
    platform: { key: row.platform_key, displayName: row.platform_name, emulationCapability: row.capability_key },
    policy: row.policy_key,
    enabled: row.enabled === 1,
    webPlayback: row.web_adapter_key && row.web_core_key
      ? { adapterKey: row.web_adapter_key, coreKey: row.web_core_key }
      : null,
  };
}

function toPlayerProfile(row: PlayerProfileRow): PlayerProfile {
  const avatarKey: ProfileAvatarKey = isProfileAvatarKey(row.avatar_key) ? row.avatar_key : "space-pilot";
  const controllerPreset: ControllerPresetKey = CONTROLLER_PRESETS.has(row.controller_preset as ControllerPresetKey) ? row.controller_preset as ControllerPresetKey : "keyboard";
  return { key: row.profile_key, displayName: row.display_name, isAdministrator: row.is_administrator === 1, avatarKey, avatarColor: row.avatar_color, themeKey: row.theme_key, accentColor: row.accent_color, controllerPreset };
}
