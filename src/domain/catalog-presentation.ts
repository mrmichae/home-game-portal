import type { CatalogCollection, GameSummary } from "./types.js";

export function deriveInitialCollections(games: GameSummary[]): CatalogCollection[] {
  const groups = new Map<string, { kind: "Series" | "Universe"; games: GameSummary[] }>();
  for (const game of games) {
    if (game.series) add(groups, `Series:${game.series}`, "Series", game);
    for (const universe of game.universes) add(groups, `Universe:${universe}`, "Universe", game);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const name = key.slice(key.indexOf(":") + 1);
      const slug = `${group.kind.toLocaleLowerCase("en-US")}-${slugify(name)}`;
      return {
        id: `automatic:${slug}`,
        slug,
        name,
        description: group.kind === "Series"
          ? `Every ${name} Game currently discovered in your library.`
          : `Games connected through the ${name} collection.`,
        games: [...group.games].sort(alpha),
      } satisfies CatalogCollection;
    })
    .filter((collection) => collection.games.length > 1)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function searchCatalog(games: GameSummary[], query: string): GameSummary[] {
  const terms = query.trim().toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  if (terms.length === 0) return games;
  return games.filter((game) => {
    const searchable = [game.displayName, game.platformName, ...game.genres, game.series ?? "", ...game.universes]
      .join(" ")
      .toLocaleLowerCase("en-US");
    return terms.every((term) => searchable.includes(term));
  });
}

export function selectFeaturedGame(games: GameSummary[], seed: number): GameSummary | undefined {
  if (games.length === 0) return undefined;
  const index = Math.abs(Math.trunc(seed)) % games.length;
  return games[index];
}

export function slugify(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function add(groups: Map<string, { kind: "Series" | "Universe"; games: GameSummary[] }>, key: string, kind: "Series" | "Universe", game: GameSummary): void {
  const group = groups.get(key) ?? { kind, games: [] };
  group.games.push(game);
  groups.set(key, group);
}

function alpha(left: GameSummary, right: GameSummary): number {
  return left.displayName.localeCompare(right.displayName, "en-US", { numeric: true });
}
