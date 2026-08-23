import { describe, expect, it } from "vitest";
import { gameplayChromeVisibility, isDeliberateVerticalSwipe, isDeliberateVerticalWheel } from "./gameplay-chrome";

describe("gameplay chrome", () => {
  it("ignores minor controller movement and predominantly horizontal gestures", () => {
    expect(isDeliberateVerticalSwipe({ x: 100, y: 100 }, { x: 108, y: 156 })).toBe(false);
    expect(isDeliberateVerticalSwipe({ x: 100, y: 100 }, { x: 190, y: 176 })).toBe(false);
    expect(isDeliberateVerticalWheel(4, 32)).toBe(false);
  });

  it("reveals controls only for a deliberate vertical gesture", () => {
    expect(isDeliberateVerticalSwipe({ x: 100, y: 100 }, { x: 112, y: 184 })).toBe(true);
    expect(isDeliberateVerticalWheel(8, -80)).toBe(true);
    expect(gameplayChromeVisibility(false, "deliberate-vertical-gesture")).toBe(true);
  });

  it("hides controls when gameplay starts or resumes", () => {
    expect(gameplayChromeVisibility(true, "game-running")).toBe(false);
    expect(gameplayChromeVisibility(true, "gameplay-input")).toBe(false);
  });
});
