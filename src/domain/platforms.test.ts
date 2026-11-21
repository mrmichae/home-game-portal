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

  it("offers browser playback for every supported platform", () => {
    expect(webPlayablePlatforms).toEqual(["nes", "snes", "atari2600"]);
  });
});
