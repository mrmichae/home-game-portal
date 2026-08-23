export interface GesturePoint {
  x: number;
  y: number;
}

const VERTICAL_SWIPE_THRESHOLD = 72;
const VERTICAL_DOMINANCE_RATIO = 1.35;

export function isDeliberateVerticalSwipe(start: GesturePoint, current: GesturePoint): boolean {
  const verticalDistance = Math.abs(current.y - start.y);
  const horizontalDistance = Math.abs(current.x - start.x);
  return verticalDistance >= VERTICAL_SWIPE_THRESHOLD
    && verticalDistance >= horizontalDistance * VERTICAL_DOMINANCE_RATIO;
}

export function isDeliberateVerticalWheel(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaY) >= 56 && Math.abs(deltaY) >= Math.abs(deltaX) * VERTICAL_DOMINANCE_RATIO;
}

export type GameplayChromeEvent = "game-running" | "deliberate-vertical-gesture" | "gameplay-input";

export function gameplayChromeVisibility(current: boolean, event: GameplayChromeEvent): boolean {
  if (event === "deliberate-vertical-gesture") return true;
  if (event === "game-running" || event === "gameplay-input") return false;
  return current;
}
