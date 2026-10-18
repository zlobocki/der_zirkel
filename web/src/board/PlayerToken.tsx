import type { BoardView } from "../api";
import { playerTokenLabel } from "./player-token-label";

export function PlayerToken({ players, seat }: { players: BoardView["players"]; seat: number }) {
  const label = playerTokenLabel(players, seat);
  const player = players.find((entry) => entry.seat === seat);
  return (
    <span className="player-token" role="img" aria-label={`${player?.username ?? "Player"} token: ${label.initial}${label.number ?? ""}`}>
      <span>{label.initial}</span>
      {label.number !== null ? <span className="player-token-number">{label.number}</span> : null}
    </span>
  );
}
