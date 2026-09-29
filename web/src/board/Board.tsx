import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import slotsFile from "./slots.json";
import type { BoardView } from "../api";

const VIEW_WIDTH = slotsFile.viewBox[0];
const VIEW_HEIGHT = slotsFile.viewBox[1];
const SLOTS = slotsFile.slots as unknown as Record<string, [number, number]>;

export const NATIONS = [
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

const ART: Record<(typeof NATIONS)[number]["id"], { army: string; fleet: string; flag: string }> = {
  ah: { army: "army_austria-hungary.svg", fleet: "fleet_austria-hungary.svg", flag: "flag_austria-hungary.png" },
  ita: { army: "army_italy.svg", fleet: "fleet_italy.svg", flag: "flag_italy.png" },
  fra: { army: "army_france.svg", fleet: "fleet_france.svg", flag: "flag_france.png" },
  uk: { army: "army_britain.svg", fleet: "fleet_britain.svg", flag: "flag_great_britain.png" },
  ger: { army: "army_germany.svg", fleet: "fleet_germany.svg", flag: "flag_germany.png" },
  rus: { army: "army_russia.svg", fleet: "fleet_russia.svg", flag: "flag_russia.png" },
};

function rondelPoint(index: number): [number, number] {
  // The printed wheel has a spoke at 12 o'clock. Taxation is the next wedge
  // clockwise, then Factory, Production, Maneuver, Investor, Import, Production, Maneuver.
  const angle = ((index * 45 - 67.5) * Math.PI) / 180;
  const radius = 13;
  return [70.21 + Math.cos(angle) * radius, 28.34 + Math.sin(angle) * radius];
}

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

type Camera = { scale: number; x: number; y: number; baseWidth: number };

const MIN_SCALE = 1;
const MAX_SCALE = 8;

function fitCamera(viewport: HTMLElement): Camera {
  const boardRatio = VIEW_WIDTH / VIEW_HEIGHT;
  const width = Math.min(viewport.clientWidth, viewport.clientHeight * boardRatio);
  const height = width / boardRatio;
  return {
    scale: 1,
    x: (viewport.clientWidth - width) / 2,
    y: (viewport.clientHeight - height) / 2,
    baseWidth: width,
  };
}

function zoomAt(camera: Camera, px: number, py: number, factor: number): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
  const ratio = scale / camera.scale;
  return {
    ...camera,
    scale,
    x: px - (px - camera.x) * ratio,
    y: py - (py - camera.y) * ratio,
  };
}

export function Board({ board }: { board: BoardView }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ scale: 1, x: 0, y: 0, baseWidth: 0 });
  const [camera, setCamera] = useState<Camera>({ scale: 1, x: 0, y: 0, baseWidth: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  function updateCamera(next: Camera) {
    cameraRef.current = next;
    setCamera(next);
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    updateCamera(fitCamera(viewport));
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      updateCamera(zoomAt(cameraRef.current, event.clientX - rect.left, event.clientY - rect.top, factor));
    };
    const onResize = () => {
      if (cameraRef.current.scale === 1) {
        updateCamera(fitCamera(viewport));
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    dragRef.current = { x: event.clientX, y: event.clientY, ox: cameraRef.current.x, oy: cameraRef.current.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    updateCamera({
      ...cameraRef.current,
      x: drag.ox + event.clientX - drag.x,
      y: drag.oy + event.clientY - drag.y,
    });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    updateCamera(zoomAt(cameraRef.current, viewport.clientWidth / 2, viewport.clientHeight / 2, factor));
  }

  return (
    <div
      className="board-window"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="board-stage"
        style={{
          width: camera.baseWidth || undefined,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        }}
      >
        <div className="board-frame">
          <img className="board-image" src="/art/game_board_v3.svg" alt="The board" />
          {board.nations.flatMap((nation) => {
            const meta = NATIONS.find((item) => item.id === nation.id);
            const name = meta?.name ?? nation.id;
            return nation.factories.map((factory) => {
              const [x, y] = slot(`${factory.region}_${factory.kind}_f`);
              return (
                <Piece key={`${nation.id}-${factory.region}`} x={x} y={y} className="map-piece factory-piece" title={`${name} ${factory.kind === "sea" ? "shipyard" : "factory"}`}>
                  <img src={factory.kind === "sea" ? "/art/factory_sea.svg" : "/art/factory_land.svg"} alt="" />
                </Piece>
              );
            });
          })}
          {NATIONS.map((nation, index) => {
            const state = board.nations.find((item) => item.id === nation.id);
            const [scoreX, scoreY] = slot(`score_${Math.min(25, state?.score ?? 0)}`);
            const [taxX, taxY] = slot(state?.tax ?? "tax_2-5");
            const rondelId = state?.rondel ?? "Rondelcenter";
            const rondelIndex = rondelId.startsWith("rondel_") ? Number(rondelId.slice("rondel_".length)) : null;
            const [rondelX, rondelY] = rondelIndex === null || Number.isNaN(rondelIndex) ? slot("Rondelcenter") : rondelPoint(rondelIndex);
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
          {board.flags.map((flag) => {
            const meta = NATIONS.find((nation) => nation.id === flag.nation);
            const art = ART[flag.nation as keyof typeof ART];
            const point = SLOTS[`${flag.region}_space`];
            if (!art || !point) {
              return null;
            }
            return (
              <Piece key={`flag-${flag.region}`} x={point[0]} y={point[1] - 2.4} className="map-piece flag-piece" title={`${meta?.name ?? flag.nation} flag`}>
                <img src={`/art/${art.flag}`} alt="" />
              </Piece>
            );
          })}
          {board.units.map((unit) => {
            const meta = NATIONS.find((nation) => nation.id === unit.nation);
            const art = ART[unit.nation as keyof typeof ART];
            const slotId = unit.kind === "fleet" && unit.harbor ? `${unit.region}_port` : `${unit.region}_space`;
            const point = SLOTS[slotId];
            if (!art || !point) {
              return null;
            }
            const sharing = board.units.filter((other) => {
              const otherSlot = other.kind === "fleet" && other.harbor ? `${other.region}_port` : `${other.region}_space`;
              return otherSlot === slotId;
            });
            const stack = sharing.findIndex((other) => other.id === unit.id);
            const dx = ((stack % 3) - 1) * 2.2;
            const dy = Math.floor(stack / 3) * 2.2;
            const src = unit.kind === "fleet" ? art.fleet : art.army;
            return (
              <Piece
                key={unit.id}
                x={point[0] + dx}
                y={point[1] + dy}
                className={`map-piece unit-piece${unit.posture === "friendly" ? " unit-friendly" : ""}`}
                title={`${meta?.name ?? unit.nation} ${unit.kind}`}
              >
                <img src={`/art/${src}`} alt="" />
              </Piece>
            );
          })}
          {board.turn ? (
            <Piece x={slot(`${board.turn.nationId}_pawn`)[0]} y={slot(`${board.turn.nationId}_pawn`)[1]} className="turn-piece" title="Turn marker">
              <img src="/art/turn_marker.png" alt="" />
            </Piece>
          ) : null}
        </div>
      </div>
      <div className="board-zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          Zoom out
        </button>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          Zoom in
        </button>
        <button
          type="button"
          onClick={() => {
            const viewport = viewportRef.current;
            if (viewport) {
              updateCamera(fitCamera(viewport));
            }
          }}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

export function PlayerPanel({ board, onTreasury }: { board: BoardView; onTreasury?: (nationId: string) => void }) {
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
                <dd>
                  {player.bonds.length === 0
                    ? "None"
                    : player.bonds
                        .map((bond) => `${NATIONS.find((nation) => nation.id === bond.nation)?.name ?? bond.nation} ${bond.price}`)
                        .join(", ")}
                </dd>
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
      <h2>Nations</h2>
      <ul className="account-list">
        {board.nations.map((nation) => {
          const meta = NATIONS.find((item) => item.id === nation.id);
          const government = board.players.find((player) => player.seat === nation.government);
          return (
            <li key={nation.id}>
              <h3>{meta?.name ?? nation.id}</h3>
              <dl>
                <div>
                  <dt>Treasury</dt>
                  <dd>{nation.treasury} million</dd>
                </div>
                <div>
                  <dt>Power</dt>
                  <dd>{nation.score}</dd>
                </div>
                <div>
                  <dt>Government</dt>
                  <dd>{government?.username ?? "None"}</dd>
                </div>
              </dl>
              {government?.you && onTreasury && (government.cash ?? 0) >= 1 ? (
                <button type="button" className="quiet" onClick={() => onTreasury(nation.id)}>
                  Pay 1 million
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
