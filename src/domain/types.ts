export type PlatformKey = "nes" | "snes" | "atari2600";
export type ControllerPresetKey = "keyboard" | "joy-con" | "switch-pro" | "apple-tv-remote";

import type { ProfileAvatarKey } from "./profile-avatars.js";

export interface PlayerProfile {
  key: string;
  displayName: string;
  isAdministrator: boolean;
  avatarKey: ProfileAvatarKey;
  avatarColor: string;
  themeKey: string;
  accentColor: string;
  controllerPreset: ControllerPresetKey;
}

export interface DiscoveredGameFile {
  relativePath: string;
  displayName: string;
  contentHash: string;
  byteSize: number;
  modifiedAtMs: number;
}

export interface PlatformIdentity {
  key: PlatformKey;
  displayName: string;
  emulationCapability: string;
}

export interface EmulatorProfile {
  platform: PlatformIdentity;
  policy: "platform-default";
  enabled: boolean;
  webPlayback: {
    adapterKey: string;
    coreKey: string;
  } | null;
}

export interface LibrarySourceConfiguration {
  rootPath: string;
  platform: PlatformIdentity;
  available: boolean;
  statusMessage: string;
  lastScannedAt: string | null;
}

export interface ScanStatus {
  status: "idle" | "scanning" | "error";
  lastScannedAt: string | null;
  message: string | null;
}

export interface AdministrationSettings {
  library: LibrarySourceConfiguration;
  emulators: EmulatorProfile[];
  scan: ScanStatus;
}

export interface GameSummary {
  id: string;
  displayName: string;
  platform: PlatformKey;
  platformName: string;
  addedAt: string;
  byteSize: number;
  releaseYear: number;
  description: string;
  genres: string[];
  series: string | null;
  universes: string[];
  coverUrl: string;
  hasServerSave: boolean;
  isContinuePlaying: boolean;
  saveUpdatedAt: string | null;
  isFavorite: boolean;
  lastPlayedAt: string | null;
  metadataStatus: "curated" | "filename" | "matched" | "corrected";
}

export interface GameDetail extends GameSummary {
  editionId: string;
  sourceDisplayName: string;
  artworkSourceUrl: string;
}

export interface CatalogCollection {
  id: string;
  slug: string;
  name: string;
  description: string;
  games: GameSummary[];
}

export interface CollectionDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  gameIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionInput {
  name: string;
  description: string;
  gameIds: string[];
}

export type BrowseRowRule =
  | { type: "all" }
  | { type: "continue" }
  | { type: "favorites" }
  | { type: "recent" }
  | { type: "genres"; genres: string[] }
  | { type: "collection"; collectionId: string };

export interface BrowseRowDefinition {
  id: string;
  title: string;
  position: number;
  rule: BrowseRowRule;
}

export interface BrowseRow extends BrowseRowDefinition {
  games: GameSummary[];
}

export interface CatalogPresentation {
  collections: CatalogCollection[];
  browseRows: BrowseRow[];
}

export interface PresentationAdministration {
  collections: CollectionDefinition[];
  browseRows: BrowseRowDefinition[];
  collectionOptions: Array<Pick<CatalogCollection, "id" | "name">>;
}

export interface BrowseRowInput {
  title: string;
  rule: BrowseRowRule;
}

export interface MetadataCorrectionInput {
  displayName: string;
  releaseYear: number;
  description: string;
  genres: string[];
  series: string | null;
  coverUrl: string | null;
}

export interface LaunchManifest {
  sessionId: string;
  gameId: string;
  gameName: string;
  platform: PlatformKey;
  emulatorProfile: {
    platformKey: PlatformKey;
    policy: "platform-default";
  };
  runtime: "emulatorjs";
  playbackProfile: {
    adapter: "emulatorjs";
    core: "fceumm";
  };
  gameUrl: string;
  resumePlan: ResumePlan;
  controllerPreset: ControllerPresetKey;
  playerProfileKey: string;
}

export const WEB_CHECKPOINT_COMPATIBILITY = {
  adapterKey: "emulatorjs",
  coreKey: "fceumm",
  // portal.2 checkpoints may have been promoted after only one advancing
  // frame, then re-captured from a stalled runtime. Keep those immutable rows
  // for rollback/inspection, but never advertise them to the corrected player.
  runtimeVersion: "4.2.3-portal.3",
} as const;

export interface CheckpointCompatibility {
  adapterKey: string;
  coreKey: string;
  runtimeVersion: string;
}

export interface ResumeCheckpoint {
  id: string;
  generation: number;
  status: "candidate" | "verified";
  capturedFrame: number;
  stateUrl: string;
  verifyUrl: string;
  rejectUrl: string;
}

export interface ResumePlan {
  captureUrl: string;
  checkpoints: ResumeCheckpoint[];
}
