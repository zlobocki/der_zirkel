import type { BoardView } from "../api";

/** A new action by the same player within a country turn is not a new turn. */
export function activePlayerKey(board: BoardView | null): string | null {
  if (!board || board.finished) return null;
  if (board.draft) return board.draft.yours ? `draft:${board.draft.nationId}:${board.draft.seat}` : null;
  const turn = board.turn;
  if (!turn?.yours || turn.actorSeat === null || turn.phase === "hold") return null;
  const role = turn.phase === "invest" || turn.phase === "veto" ? turn.phase : "government";
  return `${turn.nationId}:${turn.actorSeat}:${role}`;
}
