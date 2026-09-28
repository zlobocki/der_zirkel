import type { ReactNode } from "react";
import slotsFile from "./slots.json";
import type { BoardView } from "../api";

const VIEW_WIDTH = slotsFile.viewBox[0];
const VIEW_HEIGHT = slotsFile.viewBox[1];
const SLOTS = slotsFile.slots as unknown as Record<string, [number, number]>;

const NATIONS = [
  { id: "ah", name: "Austria-Hungary", color: "#d5bf0a" },
  { id: "ita", name: "Italy", color: "#52a63f" },
  { id: "fra", name: "France", color: "#67a8d0" },
  { id: "uk", name: "Great Britain", color: "#b31828" },
  { id: "ger", name: "Germany", color: "#84837f" },
  { id: "rus", name: "Russia", color: "#7e4095" },
] as const;

const CLUSTER = [
  [-2.3, -1.6],
  [0, -1.6],
  [2.3, -1.6],
  [-2.3, 1.6],
  [0, 1.6],
  [2.3, 1.6],
];

function slot(id: string): [number, number] {
  const point = SLOTS[id];
  if (!point) {
    throw new Error(`Missing board slot ${id}`);
  }
  return point;
}

function Piece({ x, y, className, title, children }: { x: number; y: number; className: string; title: string; children: ReactNode }) {
  return (
    <div
      className={`piece ${className}`}
      title={title}
      style={{ left: `${(x / VIEW_WIDTH) * 100}%`, top: `${(y / VIEW_HEIGHT) * 100}%` }}
    >
      {children}
    </div>
  );
}

export function Board({ board }: { board: BoardView }) {
  return (
    <div className="board-frame">
      <img className="board-image" src="/art/game_board.svg" alt="The board" />
      {board.nations.flatMap((nation) => {
        const meta = NATIONS.find((item) => item.id === nation.id);
        const name = meta?.name ?? nation.id;
        return nation.factories.map((factory) => {
          const [x, y] = slot(`${factory.region}_${factory.kind}_f`);
          return (
            <Piece key={`${nation.id}-${factory.region}`} x={x} y={y} className="factory-piece" title={`${name} ${factory.kind === "sea" ? "shipyard" : "factory"}`}>
              <img src={factory.kind === "sea" ? "/art/factory_sea.png" : "/art/factory_land.png"} alt="" />
            </Piece>
          );
        });
      })}
      {NATIONS.map((nation, index) => {
        const [scoreX, scoreY] = slot("score_0");
        const [taxX, taxY] = slot("tax_2-5");
        const [rondelX, rondelY] = slot("Rondelcenter");
        const [dx, dy] = CLUSTER[index] ?? [0, 0];
        return (
          <span key={nation.id}>
            <Piece x={scoreX + dx} y={scoreY + dy} className="marker-piece" title={`${nation.name} on the score track`}>
              <span className="marker" style={{ background: nation.color }} />
            </Piece>
            <Piece x={taxX + dx} y={taxY + dy} className="marker-piece" title={`${nation.name} on the tax track`}>
              <span className="marker" style={{ background: nation.color }} />
            </Piece>
            <Piece x={rondelX + dx} y={rondelY + dy} className="marker-piece" title={`${nation.name} on the rondel`}>
              <span className="marker" style={{ background: nation.color }} />
            </Piece>
          </span>
        );
      })}
    </div>
  );
}

export function PlayerPanel({ board }: { board: BoardView }) {
  return (
    <section className="card player-panel">
      <h2>Players</h2>
      <ul className="account-list">
        {board.players.map((player) => (
          <li key={player.seat}>
            <h3>
              {player.username ?? "Open seat"}
              {player.you ? " (you)" : ""}
            </h3>
            <dl>
              <div>
                <dt>Cash</dt>
                <dd>{player.cash === null ? "Hidden" : `${player.cash} million`}</dd>
              </div>
              <div>
                <dt>Bonds</dt>
                <dd>{player.bonds.length === 0 ? "None" : player.bonds.map((bond) => `${bond.nation} ${bond.interest}`).join(", ")}</dd>
              </div>
              <div>
                <dt>Investor</dt>
                <dd>
                  {player.investor ? <img className="panel-icon" src="/art/investor.png" alt="Investor" /> : "No"}
                </dd>
              </div>
              <div>
                <dt>Swiss bank</dt>
                <dd>
                  {player.swissBank ? <img className="panel-icon" src="/art/swiss_bank.png" alt="Swiss bank" /> : "No"}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
