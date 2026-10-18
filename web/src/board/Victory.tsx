import { useEffect, useState, type CSSProperties } from "react";
import type { BoardView } from "../api";
import { PlayerToken } from "./PlayerToken";

const BURSTS = [
  [16, 24, 0, "#ffd76a"], [78, 18, 0.55, "#f5f0c5"], [46, 35, 1.1, "#eaa8f5"],
  [28, 60, 1.7, "#84d9f4"], [85, 58, 2.3, "#ffd76a"], [55, 17, 2.8, "#ff9f8f"],
  [9, 48, 3.4, "#f5f0c5"], [66, 48, 4, "#ffd76a"], [36, 20, 4.7, "#84d9f4"],
] as const;

export function Victory({ board }: { board: BoardView }) {
  const [celebrating, setCelebrating] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setCelebrating(false), 8500);
    return () => window.clearTimeout(timer);
  }, []);
  const scores = [...(board.scores ?? [])].sort((left, right) => right.points - left.points || Number(right.winner) - Number(left.winner) || left.seat - right.seat);
  const winner = scores.find((entry) => entry.winner);
  const name = winner ? board.players.find((player) => player.seat === winner.seat)?.username ?? "The winner" : null;
  return (
    <section className="card victory" aria-labelledby="victory-title">
      {celebrating ? <div className="fireworks" aria-hidden="true">
        {BURSTS.map(([x, y, delay, color], index) => (
          <div key={index} className="firework-burst" style={{ left: `${x}%`, top: `${y}%`, "--delay": `${delay}s`, "--spark-color": color } as CSSProperties}>
            {Array.from({ length: 24 }, (_, ray) => {
              const angle = ray * Math.PI / 12;
              const distance = ray % 2 ? 120 : 175;
              return <i key={ray} style={{ "--dx": `${Math.cos(angle) * distance}px`, "--dy": `${Math.sin(angle) * distance}px` } as CSSProperties} />;
            })}
          </div>
        ))}
      </div> : null}
      <p className="victory-kicker">The final reckoning</p>
      <div className="victory-laurels" aria-hidden="true">✦</div>
      <h2 id="victory-title" aria-live="polite">{name ? `${name} triumphs!` : "Honours shared!"}</h2>
      <p className="victory-subtitle">{winner ? `An empire of ambition. A victory worth ${winner.points} points.` : "A contest worthy of the history books."}</p>
      {winner ? <div className="victory-token"><PlayerToken players={board.players} seat={winner.seat} /></div> : null}
      <h3>Final standings</h3>
      <ol className="victory-scores">
        {scores.map((score, index) => (
          <li key={score.seat} className={score.winner ? "victory-winner" : ""}>
            <span className="victory-rank">{index + 1}</span>
            <PlayerToken players={board.players} seat={score.seat} />
            <span className="victory-player">{board.players.find((player) => player.seat === score.seat)?.username ?? "Player"}{score.winner ? <small>Victor</small> : null}</span>
            <strong>{score.points}<small>points</small></strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
