export interface ShortcutHoldState {
  pressedAt: number | null;
  triggered: boolean;
}

export interface ShortcutHoldResult {
  state: ShortcutHoldState;
  trigger: boolean;
}

export const savedStateShortcutHoldMs = 700;

export function advanceSavedStateShortcut(
  state: ShortcutHoldState,
  bothShouldersPressed: boolean,
  now: number,
  holdMs = savedStateShortcutHoldMs,
): ShortcutHoldResult {
  if (!bothShouldersPressed) {
    return { state: { pressedAt: null, triggered: false }, trigger: false };
  }
  if (state.pressedAt === null) {
    return { state: { pressedAt: now, triggered: false }, trigger: false };
  }
  if (!state.triggered && now - state.pressedAt >= holdMs) {
    return { state: { ...state, triggered: true }, trigger: true };
  }
  return { state, trigger: false };
}
