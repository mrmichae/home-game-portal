import { describe, expect, it } from "vitest";
import { controllerNavigationEnabled } from "./use-controller-navigation";

describe("controller navigation routing", () => {
  it("yields all directional input to the active game player", () => {
    expect(controllerNavigationEnabled("/play/game-123")).toBe(false);
    expect(controllerNavigationEnabled("/games/game-123")).toBe(true);
    expect(controllerNavigationEnabled("/")).toBe(true);
  });
});
