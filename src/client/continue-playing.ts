import type { GameSummary } from "../domain/types";

export function continuePlayingRemovalLabel(game: Pick<GameSummary, "isContinuePlaying">): string | null {
  return game.isContinuePlaying ? "Remove from Continue Playing" : null;
}
