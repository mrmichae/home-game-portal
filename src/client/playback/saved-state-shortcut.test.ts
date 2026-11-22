import { describe, expect, it } from "vitest";
import { advanceSavedStateShortcut, type ShortcutHoldState } from "./saved-state-shortcut";

describe("saved-state gameplay shortcut", () => {
  it("requires both shoulder buttons to be held before opening the picker", () => {
    let state: ShortcutHoldState = { pressedAt: null, triggered: false };

    ({ state } = advanceSavedStateShortcut(state, true, 1_000));
    expect(advanceSavedStateShortcut(state, true, 1_699).trigger).toBe(false);
    expect(advanceSavedStateShortcut(state, true, 1_700).trigger).toBe(true);
  });

  it("fires once per hold and rearms only after the buttons are released", () => {
    let state: ShortcutHoldState = { pressedAt: 1_000, triggered: false };
    let result = advanceSavedStateShortcut(state, true, 1_700);
    expect(result.trigger).toBe(true);

    result = advanceSavedStateShortcut(result.state, true, 2_500);
    expect(result.trigger).toBe(false);

    result = advanceSavedStateShortcut(result.state, false, 2_501);
    expect(result.state).toEqual({ pressedAt: null, triggered: false });
  });
});
