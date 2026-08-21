import type { GameSummary } from "../domain/types";

export type LibrarySort = "a-z" | "z-a" | "year-new" | "year-old" | "recently-played" | "recently-added";

export const librarySortOptions: Array<{ key: LibrarySort; label: string }> = [
  { key: "a-z", label: "A–Z" },
  { key: "z-a", label: "Z–A" },
  { key: "year-new", label: "Year · Newest" },
  { key: "year-old", label: "Year · Oldest" },
  { key: "recently-played", label: "Recently Played" },
  { key: "recently-added", label: "Recently Added" },
];

export function parseLibrarySort(value: string | null): LibrarySort {
  return librarySortOptions.some((option) => option.key === value) ? value as LibrarySort : "a-z";
}

export function sortLibrary(games: GameSummary[], sort: LibrarySort): GameSummary[] {
  const sorted = [...games];
  return sorted.sort((left, right) => {
    if (sort === "z-a") return alpha(right, left);
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
