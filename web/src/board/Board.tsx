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
                  <dt>Government</dt>
                  <dd>{government?.username ?? "None"}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
