import { describe, expect, it } from "vitest";
import { metadataForGame } from "../nes-metadata.js";

describe("NES catalog metadata", () => {
  it("adds curated release information and a matching cover", () => {
    expect(metadataForGame("Mega Man", "nes/Mega Man (USA).nes")).toMatchObject({
      releaseYear: 1987,
      genres: ["Platformer", "Action"],
      series: "Mega Man",
      universes: ["Capcom Classics"],
      coverUrl: expect.stringContaining("Mega%20Man%20(USA).png"),
    });
  });

  it.each([
    ["Donkey Kong Jr (JU)", "nes/Donkey Kong Jr. (JU).nes", "Donkey%20Kong%20Jr.%20(World)%20(Rev%201).png"],
    ["Dragon Warrior 2 (U)", "nes/Dragon Warrior 2 (U).nes", "Dragon%20Warrior%20II%20(USA).png"],
    ["Kung Fu (PC10)", "nes/Kung Fu (PC10).nes", "Kung%20Fu%20(1985)(Irem)(PlayChoice-10).png"],
  ])("maps non-standard filename %s to available box art", (title, relativePath, expectedFile) => {
    expect(metadataForGame(title, relativePath).coverUrl).toContain(expectedFile);
  });
});
