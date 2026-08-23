import { describe, expect, it } from "vitest";
import type { GameSummary } from "../domain/types";
import { continuePlayingRemovalLabel } from "./continue-playing";
import { removeGameFromContinuePlaying } from "./pages/HomePage";
import type { CatalogResponse } from "./api";

describe("Continue Playing UI state", () => {
  it("shows the removal action only while the game is on the shelf", () => {
    expect(continuePlayingRemovalLabel({ isContinuePlaying: true })).toBe("Remove from Continue Playing");
    expect(continuePlayingRemovalLabel({ isContinuePlaying: false })).toBeNull();
  });

  it("optimistically removes only the matching Continue Playing card", () => {
    const continued = game("continued", true);
    const other = game("other", true);
    const catalog: CatalogResponse = {
      shelf: { id: "nes", title: "NES", games: [continued, other] },
      scan: { status: "idle", lastScannedAt: null, message: null },
      presentation: {
        collections: [],
        browseRows: [
          { id: "continue", title: "Continue Playing", position: 1, rule: { type: "continue" }, games: [continued, other] },
          { id: "all", title: "All Games", position: 2, rule: { type: "all" }, games: [continued, other] },
        ],
      },
    };

    const updated = removeGameFromContinuePlaying(catalog, continued.id)!;
    expect(updated.presentation.browseRows[0].games.map((item) => item.id)).toEqual([other.id]);
    expect(updated.presentation.browseRows[1].games).toHaveLength(2);
    expect(updated.shelf.games[0]).toMatchObject({ hasServerSave: true, isContinuePlaying: false });
  });
});

function game(id: string, isContinuePlaying: boolean): GameSummary {
  return {
    id,
    displayName: id,
    platform: "nes",
    platformName: "Nintendo Entertainment System",
    addedAt: "2026-08-23T00:00:00.000Z",
    byteSize: 16,
    releaseYear: 1990,
    description: "Fixture",
    genres: ["Action"],
    series: null,
    universes: [],
    coverUrl: "/cover.png",
    hasServerSave: true,
    isContinuePlaying,
    saveUpdatedAt: "2026-08-23T00:00:00.000Z",
    isFavorite: false,
    lastPlayedAt: null,
    metadataStatus: "curated",
  };
}
