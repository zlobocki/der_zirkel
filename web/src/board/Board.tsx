import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { positionFor, type Point } from "./occupy";
import slotsFile from "./slots.json";
import type { BoardView } from "../api";

const VIEW_WIDTH = slotsFile.viewBox[0];
const VIEW_HEIGHT = slotsFile.viewBox[1];
const SLOTS = slotsFile.slots as unknown as Record<string, Point>;
const GROUPS = slotsFile.groups as unknown as Record<string, Point[]>;

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

function tokenSrc(seat: number): string {
  return `/art/player_token_${seat + 1}.png`;
}

function ownerNote(board: BoardView, nationId: string, nationName: string): string {
  const nation = board.nations.find((item) => item.id === nationId);
  const held = board.players.map((player) => {
    const value = player.bonds.filter((bond) => bond.nation === nationId).reduce((total, bond) => total + bond.price, 0);
    return `${player.username ?? "Open seat"}: ${value} million`;
  });
  const sale = nation?.bondsForSale.length ? nation.bondsForSale.map((bond) => `${bond.price} million`).join(", ") : "none";
  return `${nationName}\nBonds held\n${held.join("\n")}\nFor sale: ${sale}`;
}

function slot(id: string): Point {
  const point = SLOTS[id];
  if (!point) {
    throw new Error(`Missing board slot ${id}`);
  }
  return point;
}

function slotList(id: string): Point[] {
  const group = GROUPS[id];
  if (group && group.length > 0) {
    return group;
  }
  const point = SLOTS[id];
  return point ? [point] : [];
}

function Piece({
  x,
  y,
  className,
  title,
  children,
  onClick,
  regionId,
  unitId,
}: {
  x: number;
  y: number;
  className: string;
  title: string;
  children: ReactNode;
  onClick?: () => void;
  regionId?: string;
  unitId?: string;
}) {
  return (
    <div
      className={`piece ${className}`}
      title={title}
      data-region={regionId}
      data-unit={unitId}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              onClick();
            }
          : undefined
      }
      style={{ left: `${(x / VIEW_WIDTH) * 100}%`, top: `${(y / VIEW_HEIGHT) * 100}%` }}
    >
      {children}
    </div>
  );
}

function sectorPath(index: number): string {
  const center = ((index * 45 - 67.5) * Math.PI) / 180;
  const start = center - (22.5 * Math.PI) / 180;
  const end = center + (22.5 * Math.PI) / 180;
  const cx = 70.21;
  const cy = 28.34;
  const arc = (radius: number, angle: number) => [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  const [x0, y0] = arc(23, start);
  const [x1, y1] = arc(23, end);
  const [x2, y2] = arc(7, end);
  const [x3, y3] = arc(7, start);
  return `M ${x0} ${y0} A 23 23 0 0 1 ${x1} ${y1} L ${x2} ${y2} A 7 7 0 0 0 ${x3} ${y3} Z`;
}

type MoveCommand = { unitId: string; region: string; posture?: "hostile" | "friendly"; label: string };

function moveCommands(board: BoardView): MoveCommand[] {
  const choices = board.turn?.choices ?? [];
  return choices.flatMap((choice) => {
    const command = choice.command;
    if (command.action !== "move" || typeof command.unitId !== "string" || typeof command.region !== "string") {
      return [];
    }
    const posture = command.posture === "hostile" || command.posture === "friendly" ? command.posture : undefined;
    return [{ unitId: command.unitId, region: command.region, posture, label: choice.label }];
  });
}

function slotKey(unit: BoardView["units"][number]): string {
  return unit.kind === "fleet" && unit.harbor ? `${unit.region}_port` : `${unit.region}_space`;
}

function occupants(board: BoardView): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  const units = [...board.units].sort((left, right) => left.id.localeCompare(right.id));
  for (const unit of units) {
    const key = slotKey(unit);
    buckets.set(key, [...(buckets.get(key) ?? []), unit.id]);
  }
  for (const flag of board.flags) {
    const key = `${flag.region}_space`;
    buckets.set(key, [...(buckets.get(key) ?? []), `flag:${flag.region}`]);
  }
  return buckets;
}

function arrivalSlot(board: BoardView, unit: BoardView["units"][number], region: string): Point {
  const staying = unit.kind === "fleet" && unit.harbor && region === unit.region;
  const key = unit.kind === "fleet" && staying ? `${region}_port` : `${region}_space`;
  const ids = (occupants(board).get(key) ?? []).filter((id) => id !== unit.id);
  const unitsHere = ids.filter((id) => !id.startsWith("flag:"));
  const flag = ids.find((id) => id.startsWith("flag:"));
  const order = [...unitsHere, unit.id, ...(flag ? [flag] : [])];
  return positionFor(slotList(key), order, unit.id) ?? slotList(key)[0] ?? [0, 0];
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

export function Board({ board, onCommand }: { board: BoardView; onCommand?: (command: Record<string, unknown>) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ scale: 1, x: 0, y: 0, baseWidth: 0 });
  const [camera, setCamera] = useState<Camera>({ scale: 1, x: 0, y: 0, baseWidth: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [postureFor, setPostureFor] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const turnKey = `${board.turn?.nationId ?? ""}:${board.turn?.phase ?? ""}:${board.turn?.choices.length ?? 0}`;

  useEffect(() => {
    setSelectedUnit(null);
    setPostureFor(null);
  }, [turnKey]);

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
      if (!event.ctrlKey) {
        return;
      }
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
    const stopMiddle = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("mousedown", stopMiddle, { capture: true });
    viewport.addEventListener("auxclick", stopMiddle);
    window.addEventListener("resize", onResize);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("mousedown", stopMiddle, { capture: true });
      viewport.removeEventListener("auxclick", stopMiddle);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function onMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    setPanning(true);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: cameraRef.current.x, oy: cameraRef.current.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    event.preventDefault();
    updateCamera({
      ...cameraRef.current,
      x: drag.ox + event.clientX - drag.x,
      y: drag.oy + event.clientY - drag.y,
    });
  }

  function onPointerUp() {
    dragRef.current = null;
    setPanning(false);
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    updateCamera(zoomAt(cameraRef.current, viewport.clientWidth / 2, viewport.clientHeight / 2, factor));
  }

  const laid = occupants(board);
  const moves = board.turn?.yours ? moveCommands(board) : [];
  const movable = new Set(moves.map((move) => move.unitId));
  const selectedMoves = moves.filter((move) => move.unitId === selectedUnit && move.region !== board.units.find((unit) => unit.id === selectedUnit)?.region);
  const rondelChoices = board.turn?.yours && board.turn.phase === "rondel" ? board.turn.choices.filter((choice) => choice.command.action === "rondel") : [];

  return (
    <div
      className={`board-window${panning ? " panning" : ""}`}
      ref={viewportRef}
      onMouseDown={onMouseDown}
      onAuxClick={(event) => event.preventDefault()}
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
            const key = `${flag.region}_space`;
            const point = positionFor(slotList(key), laid.get(key) ?? [], `flag:${flag.region}`);
            if (!art || !point) {
              return null;
            }
            return (
              <Piece key={`flag-${flag.region}`} x={point[0]} y={point[1]} className="map-piece flag-piece" title={`${meta?.name ?? flag.nation} flag`} regionId={flag.region}>
                <img src={`/art/${art.flag}`} alt="" />
              </Piece>
            );
          })}
          {board.units.map((unit) => {
            const meta = NATIONS.find((nation) => nation.id === unit.nation);
            const art = ART[unit.nation as keyof typeof ART];
            const key = slotKey(unit);
            const point = positionFor(slotList(key), laid.get(key) ?? [], unit.id);
            if (!art || !point) {
              return null;
            }
            const src = unit.kind === "fleet" ? art.fleet : art.army;
            const ready = movable.has(unit.id);
            const selected = selectedUnit === unit.id;
            return (
              <Piece
                key={unit.id}
                x={point[0]}
                y={point[1]}
                className={`map-piece unit-piece${unit.posture === "friendly" ? " unit-friendly" : ""}${ready ? " unit-ready" : ""}${selected ? " unit-selected" : ""}`}
                title={`${meta?.name ?? unit.nation} ${unit.kind}`}
                regionId={unit.region}
                unitId={unit.id}
                onClick={
                  ready
                    ? () => {
                        setSelectedUnit(unit.id);
                        setPostureFor(null);
                      }
                    : undefined
                }
              >
                <img src={`/art/${src}`} alt="" />
              </Piece>
            );
          })}
          {NATIONS.map((nation) => {
            const state = board.nations.find((item) => item.id === nation.id);
            if (!state) {
              return null;
            }
            const [taxX, taxY] = slot(`${nation.id}_tax`);
            const [treasuryX, treasuryY] = slot(`${nation.id}_treasury`);
            const government = board.players.find((player) => player.seat === state.government);
            const [ownerX, ownerY] = slot(`${nation.id}_owner`);
            return (
              <span key={`${nation.id}-status`}>
                <Piece x={taxX} y={taxY} className="nation-value" title={`${nation.name} tax ${state.taxation}`}>
                  {state.taxation}
                </Piece>
                <Piece x={treasuryX} y={treasuryY} className="nation-value" title={`${nation.name} treasury ${state.treasury} million`}>
                  {state.treasury}
                </Piece>
                {government ? (
                  <Piece x={ownerX} y={ownerY} className="owner-piece" title={ownerNote(board, nation.id, nation.name)}>
                    <img src={tokenSrc(government.seat)} alt={`${government.username ?? "Player"} governs ${nation.name}`} />
                  </Piece>
                ) : null}
              </span>
            );
          })}
          {board.turn ? (
            <Piece x={slot(`${board.turn.nationId}_pawn`)[0]} y={slot(`${board.turn.nationId}_pawn`)[1]} className="turn-piece" title="Turn marker">
              <img src="/art/turn_marker.png" alt="" />
            </Piece>
          ) : null}
          {rondelChoices.length > 0 ? (
            <svg className="rondel-layer" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
              {rondelChoices.map((choice) => {
                const index = Number(choice.command.index);
                if (!Number.isInteger(index)) {
                  return null;
                }
                return (
                  <path
                    key={index}
                    d={sectorPath(index)}
                    className="rondel-hit"
                    aria-label={choice.label}
                    onClick={() => onCommand?.({ action: "rondel", index })}
                  >
                    <title>{choice.label}</title>
                  </path>
                );
              })}
            </svg>
          ) : null}
          {[...new Set(selectedMoves.map((move) => move.region))].map((region) => {
            const unit = board.units.find((entry) => entry.id === selectedUnit);
            const options = selectedMoves.filter((move) => move.region === region);
            const direct = options.length === 1 ? options[0] : undefined;
            if (!unit) {
              return null;
            }
            const [x, y] = arrivalSlot(board, unit, region);
            return (
              <span key={`${selectedUnit}-${region}`}>
                <Piece
                  x={x}
                  y={y}
                  className="move-dot"
                  regionId={region}
                  title={direct?.label ?? "Choose how the army enters"}
                  onClick={() => {
                    if (!onCommand || !selectedUnit) {
                      return;
                    }
                    if (!direct) {
                      setPostureFor(region);
                      return;
                    }
                    onCommand({
                      action: "move",
                      unitId: selectedUnit,
                      region,
                      ...(direct.posture ? { posture: direct.posture } : {}),
                    });
                  }}
                >
                  <span />
                </Piece>
                {postureFor === region
                  ? options.map((option, index) => (
                      <Piece
                        key={option.posture ?? "enter"}
                        x={x + (index === 0 ? -6 : 6)}
                        y={y + 4}
                        className="move-posture"
                        title={option.posture === "hostile" ? "Hostile" : "Friendly"}
                        onClick={() =>
                          onCommand?.({
                            action: "move",
                            unitId: option.unitId,
                            region,
                            ...(option.posture ? { posture: option.posture } : {}),
                          })
                        }
                      >
                        {option.posture === "hostile" ? "Hostile" : "Friendly"}
                      </Piece>
                    ))
                  : null}
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
    <section className="player-board" aria-label="Players">
      <h2>Players</h2>
      <div className="player-grid">
        {board.players.map((player) => {
          return (
            <article className="card player-card" key={player.seat}>
              <h3 className="player-name">
                <img src={tokenSrc(player.seat)} alt="" />
                <span>
                  {player.username ?? "Open seat"}
                  {player.you ? " (you)" : ""}
                </span>
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
