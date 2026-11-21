import { describe, expect, it } from "vitest";
import type { GameSummary } from "../domain/types";
import { filterLibraryByPlatform, parseLibraryPlatformFilter, parseLibrarySort, sortLibrary } from "./library-sort";

const games = [
  game("B Game", "snes", "Super Nintendo Entertainment System", 1992, "2026-01-01", null),
  game("A Game", "nes", "Nintendo Entertainment System", 1987, "2026-03-01", "2026-04-01"),
  game("C Game", "atari2600", "Atari 2600", 1987, "2026-02-01", "2026-05-01"),
];

describe("My Library sorting", () => {
  it("defaults unknown values to A-Z", () => expect(parseLibrarySort("nope")).toBe("a-z"));
  it("sorts alphabetically and by release year", () => {
    expect(sortLibrary(games, "a-z").map(({ displayName }) => displayName)).toEqual(["A Game", "B Game", "C Game"]);
    expect(sortLibrary(games, "year-old").map(({ displayName }) => displayName)).toEqual(["A Game", "C Game", "B Game"]);
  });
  it("puts played Games first in most-recent order", () => {
    expect(sortLibrary(games, "recently-played").map(({ displayName }) => displayName)).toEqual(["C Game", "A Game", "B Game"]);
  });
  it("groups Games by Platform, then alphabetizes within each Platform", () => {
    expect(sortLibrary(games, "platform").map(({ displayName }) => displayName)).toEqual(["C Game", "A Game", "B Game"]);
  });
  it("parses and applies a Platform filter", () => {
    expect(parseLibraryPlatformFilter("atari2600")).toBe("atari2600");
    expect(parseLibraryPlatformFilter("unknown")).toBe("all");
    expect(filterLibraryByPlatform(games, "snes").map(({ displayName }) => displayName)).toEqual(["B Game"]);
    expect(filterLibraryByPlatform(games, "all")).toBe(games);
  });
});

function game(displayName: string, platform: GameSummary["platform"], platformName: string, releaseYear: number, addedAt: string, lastPlayedAt: string | null): GameSummary {
  return { id: displayName, displayName, platform, platformName, addedAt, byteSize: 1, releaseYear, description: "", genres: ["Action"], series: null, universes: [], coverUrl: "", hasServerSave: false, isContinuePlaying: false, saveUpdatedAt: null, isFavorite: false, lastPlayedAt, metadataStatus: "curated" };
}
