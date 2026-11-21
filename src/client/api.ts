import type { AdministrationSettings, BrowseRowDefinition, BrowseRowInput, CatalogPresentation, CollectionDefinition, CollectionInput, ControllerPresetKey, GameDetail, GameSummary, LaunchManifest, LibrarySourceConfiguration, MetadataCorrectionInput, PlayerProfile, PresentationAdministration, SavedState } from "../domain/types";
import type { ProfileAvatarKey } from "../domain/profile-avatars";
import { readActiveProfileKey } from "./profile-storage";

export interface CatalogResponse {
  shelf: {
    id: string;
    title: string;
    games: GameSummary[];
  };
  scan: {
    status: "idle" | "scanning" | "error";
    lastScannedAt: string | null;
    message: string | null;
  };
  presentation: CatalogPresentation;
}

export interface PendingDevicePairing {
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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("X-Player-Profile", readActiveProfileKey());
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "The portal did not respond. Please try again.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  profiles: () => request<{ profiles: PlayerProfile[] }>("/api/player-profiles"),
  createProfile: (displayName: string, avatarKey: ProfileAvatarKey) => request<{ profile: PlayerProfile }>("/api/player-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, avatarKey }) }),
  updateProfile: (profileKey: string, displayName: string, avatarKey: ProfileAvatarKey) => request<{ profile: PlayerProfile }>(`/api/player-profiles/${profileKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, avatarKey }) }),
  updateProfilePreferences: (profileKey: string, themeKey: string, accentColor: string) => request<{ profile: PlayerProfile }>(`/api/player-profiles/${profileKey}/preferences`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ themeKey, accentColor }) }),
  updateProfileController: (profileKey: string, controllerPreset: ControllerPresetKey) => request<{ profile: PlayerProfile }>(`/api/player-profiles/${profileKey}/controller`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ controllerPreset }) }),
  administrationSettings: () => request<AdministrationSettings>("/api/admin/settings"),
  devicePairings: () => request<{ pairings: PendingDevicePairing[] }>("/api/admin/device-pairings"),
  clientDevices: () => request<{ devices: ClientDevice[] }>("/api/admin/client-devices"),
  approveDevicePairing: (code: string) => request<{ device: ClientDevice }>("/api/admin/device-pairings/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }),
  denyDevicePairing: (pairingId: string) => request<void>(`/api/admin/device-pairings/${pairingId}/deny`, { method: "POST" }),
  revokeClientDevice: (deviceId: string) => request<void>(`/api/admin/client-devices/${deviceId}`, { method: "DELETE" }),
  presentationAdministration: () => request<PresentationAdministration>("/api/admin/presentation"),
  createCollection: (input: CollectionInput) => request<{ collection: CollectionDefinition }>("/api/admin/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateCollection: (collectionId: string, input: CollectionInput) => request<{ collection: CollectionDefinition }>(`/api/admin/collections/${collectionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteCollection: (collectionId: string) => request<void>(`/api/admin/collections/${collectionId}`, { method: "DELETE" }),
  createBrowseRow: (input: BrowseRowInput) => request<{ row: BrowseRowDefinition }>("/api/admin/browse-rows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateBrowseRow: (rowId: string, input: BrowseRowInput) => request<{ row: BrowseRowDefinition }>(`/api/admin/browse-rows/${rowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteBrowseRow: (rowId: string) => request<void>(`/api/admin/browse-rows/${rowId}`, { method: "DELETE" }),
  orderBrowseRows: (ids: string[]) => request<{ rows: BrowseRowDefinition[] }>("/api/admin/browse-rows/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }),
  updateLibraryRoot: (rootPath: string) => request<{ library: LibrarySourceConfiguration }>("/api/admin/library", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rootPath }) }),
  catalog: () => request<CatalogResponse>("/api/catalog"),
  rescan: () =>
    request<{ discovered: number; added: number; metadataMatched: number; scannedAt: string }>("/api/admin/rescan", {
      method: "POST",
    }),
  game: (gameId: string) => request<{ game: GameDetail }>(`/api/games/${gameId}`),
  favorite: (gameId: string, favorite: boolean) =>
    request<{ game: GameDetail }>(`/api/games/${gameId}/favorite`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }),
  removeFromContinuePlaying: (gameId: string) =>
    request<{ game: GameDetail }>(`/api/games/${gameId}/continue-playing`, { method: "DELETE" }),
  launch: (gameId: string, savedStateId?: string | null) =>
    request<{ manifest: LaunchManifest }>(`/api/games/${gameId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(savedStateId ? { savedStateId } : {}),
    }),
  savedStates: (gameId: string) => request<{ savedStates: SavedState[] }>(`/api/games/${gameId}/saved-states`),
  createSavedState: async (captureUrl: string, state: Uint8Array, capturedFrame: number, thumbnail: Blob | null) => {
    const result = await request<{ savedState: SavedState }>(captureUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Captured-Frame": String(capturedFrame) },
      body: state.slice().buffer as ArrayBuffer,
    });
    if (thumbnail) {
      await request<{ savedState: SavedState }>(`${captureUrl.split("?")[0]}/${result.savedState.id}/thumbnail`, {
        method: "PUT",
        headers: { "Content-Type": thumbnail.type || "image/webp" },
        body: thumbnail,
      }).catch(() => undefined);
    }
    return result.savedState;
  },
  renameSavedState: (gameId: string, savedStateId: string, label: string) =>
    request<{ savedState: SavedState }>(`/api/games/${gameId}/saved-states/${savedStateId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }),
    }),
  deleteSavedState: (gameId: string, savedStateId: string) =>
    request<void>(`/api/games/${gameId}/saved-states/${savedStateId}`, { method: "DELETE" }),
  correctMetadata: (gameId: string, correction: MetadataCorrectionInput) => request<{ game: GameDetail }>(`/api/admin/games/${gameId}/metadata`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(correction) }),
  resetMetadata: (gameId: string) => request<{ game: GameDetail }>(`/api/admin/games/${gameId}/metadata`, { method: "DELETE" }),
};
