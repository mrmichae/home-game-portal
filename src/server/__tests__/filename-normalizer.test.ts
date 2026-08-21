import { describe, expect, it } from "vitest";
import { normalizeGameFilename } from "../filename-normalizer.js";

describe("filename normalization", () => {
  it.each([
    ["001 - super_mario_bros_(USA)_[!].nes", "Super Mario Bros"],
    ["the-legend-of-zelda (Rev A).NES", "The Legend of Zelda"],
    ["MEGA MAN III (USA).nes", "Mega Man III"],
    ["R.B.I. Baseball.nes", "R B I Baseball"],
    ["Kirby's Adventure (Europe) (En,Fr,De,Es,It).nes", "Kirby's Adventure"],
  ])("derives %s as %s", (filename, expected) => {
    expect(normalizeGameFilename(filename)).toBe(expected);
  });

  it("falls back safely for a tag-only filename", () => {
    expect(normalizeGameFilename("[!].nes")).toBe("Untitled Game");
  });
});
