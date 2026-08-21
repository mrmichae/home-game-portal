import { describe, expect, it } from "vitest";
import type { GameSummary } from "../domain/types";
import { selectFeaturedGame } from "../domain/catalog-presentation";
import { buildCollections, searchCatalog } from "./catalog-collections";

const games = [
  game("1", "Mega Man", "Mega Man", ["Capcom Classics"], ["Platformer", "Action"]),
  game("2", "Mega Man 3", "Mega Man", ["Capcom Classics"], ["Platformer", "Action"]),
  game("3", "DuckTales", "DuckTales", ["Capcom Classics", "Disney Afternoon"], ["Platformer"]),
];

describe("Catalog search and Collections", () => {
  it("searches title, Platform, genre, Series, and universe terms", () => {
    expect(searchCatalog(games, "mega action").map((item) => item.id)).toEqual(["1", "2"]);
    expect(searchCatalog(games, "Nintendo Entertainment System")).toHaveLength(3);
    expect(searchCatalog(games, "Disney Afternoon").map((item) => item.id)).toEqual(["3"]);
  });

  it("derives the initial editable Collections with stable slugs", () => {
    expect(buildCollections(games)).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "series-mega-man", name: "Mega Man", games: expect.any(Array) }),
      expect.objectContaining({ slug: "universe-capcom-classics", name: "Capcom Classics", games: expect.any(Array) }),
    ]));
  });

  it("selects a stable Featured title for a login seed and rotates with the next seed", () => {
    expect(selectFeaturedGame(games, 1)?.id).toBe("2");
    expect(selectFeaturedGame(games, 2)?.id).toBe("3");
    expect(selectFeaturedGame([], 2)).toBeUndefined();
  });
});

function game(id: string, displayName: string, series: string | null, universes: string[], genres: string[]): GameSummary {
  return {
    id,
    displayName,
    platform: "nes",
    platformName: "Nintendo Entertainment System",
    addedAt: "2026-08-16T00:00:00.000Z",
    byteSize: 1,
    releaseYear: 1990,
    description: "Test game",
    genres,
    series,
    universes,
    coverUrl: "/cover.png",
    hasServerSave: false,
    saveUpdatedAt: null,
    isFavorite: false,
    lastPlayedAt: null,
    metadataStatus: "curated",
  };
}
