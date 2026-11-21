import { describe, expect, it } from "vitest";
import { artworkOrientation, webPlayablePlatforms } from "./platforms";

describe("platform artwork orientation", () => {
  it("uses the historically appropriate box shape for Nintendo platforms", () => {
    expect(artworkOrientation("nes")).toBe("portrait");
    expect(artworkOrientation("snes")).toBe("landscape");
  });

  it("keeps platforms without a landscape convention portrait by default", () => {
    expect(artworkOrientation("atari2600")).toBe("portrait");
  });

  it("exposes Atari 2600 as a browser-playable Platform", () => {
    expect(webPlayablePlatforms).toContain("atari2600");
  });
});
