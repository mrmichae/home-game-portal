import type { GameSummary, PlatformKey } from "../domain/types";

export type LibrarySort = "a-z" | "z-a" | "platform" | "year-new" | "year-old" | "recently-played" | "recently-added";
export type LibraryPlatformFilter = "all" | PlatformKey;

export const librarySortOptions: Array<{ key: LibrarySort; label: string }> = [
  { key: "a-z", label: "A–Z" },
  { key: "z-a", label: "Z–A" },
  { key: "platform", label: "Platform" },
  { key: "year-new", label: "Year · Newest" },
  { key: "year-old", label: "Year · Oldest" },
  { key: "recently-played", label: "Recently Played" },
  { key: "recently-added", label: "Recently Added" },
];

export const libraryPlatformFilterOptions: Array<{ key: LibraryPlatformFilter; label: string }> = [
  { key: "all", label: "All platforms" },
  { key: "nes", label: "NES" },
  { key: "snes", label: "Super Nintendo" },
  { key: "atari2600", label: "Atari 2600" },
];

export function parseLibrarySort(value: string | null): LibrarySort {
  return librarySortOptions.some((option) => option.key === value) ? value as LibrarySort : "a-z";
}

export function parseLibraryPlatformFilter(value: string | null): LibraryPlatformFilter {
  return libraryPlatformFilterOptions.some((option) => option.key === value) ? value as LibraryPlatformFilter : "all";
}

export function filterLibraryByPlatform(games: GameSummary[], platform: LibraryPlatformFilter): GameSummary[] {
  return platform === "all" ? games : games.filter((game) => game.platform === platform);
}

export function sortLibrary(games: GameSummary[], sort: LibrarySort): GameSummary[] {
  const sorted = [...games];
  return sorted.sort((left, right) => {
    if (sort === "z-a") return alpha(right, left);
    if (sort === "platform") return left.platformName.localeCompare(right.platformName, "en-US") || alpha(left, right);
    if (sort === "year-new") return right.releaseYear - left.releaseYear || alpha(left, right);
    if (sort === "year-old") return left.releaseYear - right.releaseYear || alpha(left, right);
    if (sort === "recently-played") return nullableDateDesc(left.lastPlayedAt, right.lastPlayedAt) || alpha(left, right);
    if (sort === "recently-added") return right.addedAt.localeCompare(left.addedAt) || alpha(left, right);
    return alpha(left, right);
  });
}

function nullableDateDesc(left: string | null, right: string | null): number {
  if (left && right) return right.localeCompare(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function alpha(left: GameSummary, right: GameSummary): number {
  return left.displayName.localeCompare(right.displayName, "en-US", { numeric: true });
}
