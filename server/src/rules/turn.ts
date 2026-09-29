import {
  ARMY_CAP,
  BOND_PRICE,
  FLEET_CAP,
  NATION_NAME,
  NATION_ORDER,
  RONDEL,
  bondPrice,
  powerPointsForTax,
  rondelCost,
  scoreFactor,
  taxTrack,
  type NationId,
} from "./constants.js";
import { playAutomaticDraft, type BondHolding, type DraftCursor, type DraftPlayer } from "./draft.js";
import { regions } from "./map.js";

export type Unit = {
  id: string;
  nation: NationId;
  kind: "army" | "fleet";
  region: string;
  harbor: boolean;
  posture: "standing" | "hostile" | "friendly";
};

export type Flag = {
  region: string;
  nation: NationId;
};

export type TurnPhase =
  | "rondel"
  | "veto"
  | "factory"
  | "import"
  | "fleets"
  | "fleet-battle"
  | "armies"
  | "army-battle"
  | "destroy"
  | "invest"
  | "confirm";

export type TurnState = {
  nationId: NationId;
  phase: TurnPhase;
  passedInvestor: boolean;
  checkpoint: Board;
  moved: string[];
  imported: number;
  battleRegions: string[];
  battleNations: NationId[];
  attackerDone: boolean;
  investors: number[];
  vetoSeats: number[];
  pendingIndex: number | null;
  hold: boolean;
};

export type BoardNation = {
  id: NationId;
  score: number;
  tax: string;
  rondel: string;
  rondelIndex: number | null;
  treasury: number;
  government: number | null;
  factories: Array<{ region: string; kind: "land" | "sea" }>;
};

export type BoardPlayer = DraftPlayer & {
  userId: string | null;
  username: string | null;
};

export type Board = {
  nations: BoardNation[];
  players: BoardPlayer[];
  piles: Record<NationId, number[]>;
  draft: DraftCursor | null;
  units: Unit[];
  flags: Flag[];
  nextUnit: number;
  finished: boolean;
  turn: TurnState | null;
};

export type TurnCommand =
  | { action: "rondel"; index: number }
  | { action: "veto"; block: boolean }
  | { action: "factory"; region: string | null }
  | { action: "import"; kind: "army" | "fleet"; region: string }
  | { action: "import-done" }
  | { action: "move"; unitId: string; region: string; posture?: "hostile" | "friendly" }
  | { action: "moves-done" }
  | { action: "fight"; ownId: string; enemyId: string }
  | { action: "peace" }
  | { action: "destroy"; region: string | null }
  | { action: "invest"; nationId: NationId | null; interest: number | null; replaceInterest: number | null }
  | { action: "confirm" }
  | { action: "undo" }
  | { action: "continue" }
  | { action: "treasury"; nationId: NationId };

export type TurnChoice = {
  label: string;
  command: TurnCommand;
};

export type TurnView = {
  nationId: NationId;
  phase: TurnPhase | "hold";
  yours: boolean;
  prompt: string;
  choices: TurnChoice[];
  canUndo: boolean;
  canConfirm: boolean;
};

const TAX_SPACES = ["tax_2-5", "tax_6", "tax_7", "tax_8", "tax_9", "tax_10", "tax_11", "tax_12", "tax_13", "tax_14", "tax_15+"];
const RONDEL_LABEL = ["Taxation", "Factory", "Production", "Maneuver", "Investor", "Import", "Production", "Maneuver"];

function isNation(value: string): value is NationId {
  return (NATION_ORDER as readonly string[]).includes(value);
}

export function normalizeBoard(board: Board): Board {
  return {
    ...board,
    units: board.units ?? [],
    flags: board.flags ?? [],
    nextUnit: board.nextUnit ?? 1,
    finished: Boolean(board.finished),
    turn: board.turn ?? null,
    nations: board.nations.map((nation) => {
      const rondel = nation.rondel ?? "Rondelcenter";
      const parsed = rondel.startsWith("rondel_") ? Number(rondel.slice("rondel_".length)) : null;
      return {
        ...nation,
        score: nation.score ?? 0,
        tax: nation.tax ?? "tax_2-5",
        rondel,
        rondelIndex: nation.rondelIndex === undefined ? (Number.isInteger(parsed) ? parsed : null) : nation.rondelIndex,
        treasury: nation.treasury ?? 0,
        government: nation.government ?? null,
        factories: nation.factories ?? [],
      };
    }),
    players: board.players.map((player) => ({
      ...player,
      bonds: player.bonds ?? [],
      investor: Boolean(player.investor),
      swissBank: Boolean(player.swissBank),
    })),
  };
}

function activeNation(board: Board): BoardNation {
  const nation = board.nations.find((entry) => entry.id === board.turn?.nationId);
  if (!nation) {
    throw new Error("The active nation is missing.");
  }
  return nation;
}

function governmentSeat(board: Board): number | null {
  if (!board.turn) {
    return null;
  }
  return board.nations.find((nation) => nation.id === board.turn?.nationId)?.government ?? null;
}

function playerAt(board: Board, seat: number): BoardPlayer | undefined {
  return board.players.find((player) => player.seat === seat);
}

export function actingSeat(board: Board): number | null {
  const turn = board.turn;
  if (!turn || board.finished || turn.hold) {
    return null;
  }
  if (turn.phase === "veto") {
    return turn.vetoSeats[0] ?? null;
  }
  if (turn.phase === "invest") {
    return turn.investors[0] ?? null;
  }
  if ((turn.phase === "fleet-battle" || turn.phase === "army-battle") && turn.attackerDone) {
    const nation = turn.battleNations[0];
    return nation ? (board.nations.find((entry) => entry.id === nation)?.government ?? null) : governmentSeat(board);
  }
  return governmentSeat(board);
}

function homes(nation: NationId): string[] {
  return [...regions.values()].filter((region) => region.home === nation).map((region) => region.id);
}

function regionName(id: string): string {
  return regions.get(id)?.name ?? id;
}

function hostileArmies(board: Board, regionId: string, owner: NationId): boolean {
  return board.units.some(
    (unit) => unit.kind === "army" && unit.region === regionId && unit.posture === "hostile" && unit.nation !== owner,
  );
}

function unitCount(board: Board, nation: NationId, kind: Unit["kind"]): number {
  return board.units.filter((unit) => unit.nation === nation && unit.kind === kind).length;
}

function addUnit(board: Board, nation: NationId, kind: Unit["kind"], region: string, harbor: boolean): string | null {
  const cap = kind === "army" ? ARMY_CAP[nation] : FLEET_CAP[nation];
  if (unitCount(board, nation, kind) >= cap) {
    return "That nation has no room for another unit.";
  }
  const id = `u${board.nextUnit}`;
  board.nextUnit += 1;
  board.units.push({ id, nation, kind, region, harbor, posture: "standing" });
  return null;
}

function interestOwed(board: Board, nationId: NationId): number {
  return board.players.reduce(
    (sum, player) => sum + player.bonds.filter((bond) => bond.nation === nationId).reduce((total, bond) => total + bond.interest, 0),
    0,
  );
}

function passesInvestor(from: number, to: number): boolean {
  const steps = (to - from + RONDEL.length) % RONDEL.length;
  for (let step = 1; step < steps; step += 1) {
    if ((from + step) % RONDEL.length === 4) {
      return true;
    }
  }
  return false;
}

function payInterest(board: Board, nationId: NationId): string | null {
  const nation = board.nations.find((entry) => entry.id === nationId);
  const government = nation?.government === null || nation?.government === undefined ? undefined : playerAt(board, nation.government);
  if (!nation || !government) {
    return "That nation has no government.";
  }
  const owed = new Map<number, number>();
  for (const player of board.players) {
    const amount = player.bonds.filter((bond) => bond.nation === nationId).reduce((total, bond) => total + bond.interest, 0);
    if (amount > 0) {
      owed.set(player.seat, amount);
    }
  }
  const total = [...owed.values()].reduce((sum, amount) => sum + amount, 0);
  const governmentOwed = owed.get(government.seat) ?? 0;
  const others = total - governmentOwed;
  if (nation.treasury >= total) {
    nation.treasury -= total;
    for (const player of board.players) {
      player.cash += owed.get(player.seat) ?? 0;
    }
    return null;
  }
  const shortfall = Math.max(0, others - nation.treasury);
  if (shortfall > government.cash) {
    return "The treasury cannot pay the interest.";
  }
  nation.treasury -= Math.min(nation.treasury, others);
  const governmentPaid = Math.min(governmentOwed, nation.treasury);
  nation.treasury -= governmentPaid;
  government.cash += governmentPaid - shortfall;
  for (const player of board.players) {
    if (player.seat !== government.seat) {
      player.cash += owed.get(player.seat) ?? 0;
    }
  }
  return null;
}

function canPayInterest(board: Board, nationId: NationId): boolean {
  return payInterest(structuredClone(board), nationId) === null;
}

function taxRevenue(board: Board, nationId: NationId): number {
  const nation = board.nations.find((entry) => entry.id === nationId);
  if (!nation) {
    return 0;
  }
  const factories = nation.factories.filter((factory) => !hostileArmies(board, factory.region, nationId)).length;
  const flags = board.flags.filter((flag) => flag.nation === nationId).length;
  return Math.min(25, factories * 2 + flags);
}

function canBuild(board: Board, nationId: NationId): boolean {
  const nation = board.nations.find((entry) => entry.id === nationId);
  return Boolean(nation && nation.treasury >= 5 && factorySites(board, nationId).length > 0);
}

function canProduce(board: Board, nationId: NationId): boolean {
  const nation = board.nations.find((entry) => entry.id === nationId);
  if (!nation) {
    return false;
  }
  return nation.factories.some((factory) => {
    if (hostileArmies(board, factory.region, nationId)) {
      return false;
    }
    const kind = factory.kind === "sea" ? "fleet" : "army";
    return unitCount(board, nationId, kind) < (kind === "army" ? ARMY_CAP[nationId] : FLEET_CAP[nationId]);
  });
}

function factorySites(board: Board, nationId: NationId): Array<{ region: string; kind: "land" | "sea" }> {
  const nation = board.nations.find((entry) => entry.id === nationId);
  if (!nation) {
    return [];
  }
  return homes(nationId)
    .filter((region) => !nation.factories.some((factory) => factory.region === region) && !hostileArmies(board, region, nationId))
    .map((region) => ({ region, kind: regions.get(region)?.port ? "sea" as const : "land" as const }));
}

function importSites(board: Board, nationId: NationId, kind: Unit["kind"]): string[] {
  return homes(nationId).filter((region) => {
    if (hostileArmies(board, region, nationId)) {
      return false;
    }
    if (kind === "fleet" && !regions.get(region)?.port) {
      return false;
    }
    const cap = kind === "army" ? ARMY_CAP[nationId] : FLEET_CAP[nationId];
    return unitCount(board, nationId, kind) < cap;
  });
}

function canImport(board: Board): boolean {
  const nation = activeNation(board);
  if (nation.treasury < 1 || (board.turn?.imported ?? 0) >= 3) {
    return false;
  }
  return importSites(board, nation.id, "army").length > 0 || importSites(board, nation.id, "fleet").length > 0;
}

function openTurn(board: Board, nationId: NationId): void {
  const checkpoint = structuredClone(board);
  checkpoint.turn = null;
  board.turn = {
    nationId,
    phase: "rondel",
    passedInvestor: false,
    checkpoint,
    moved: [],
    imported: 0,
    battleRegions: [],
    battleNations: [],
    attackerDone: false,
    investors: [],
    vetoSeats: [],
    pendingIndex: null,
    hold: false,
  };
}

function beginTurn(board: Board, nationId: NationId): Board {
  const next = structuredClone(board);
  openTurn(next, nationId);
  return next;
}

function nextNation(board: Board, current: NationId): NationId | null {
  const start = NATION_ORDER.indexOf(current);
  for (let step = 1; step <= NATION_ORDER.length; step += 1) {
    const id = NATION_ORDER[(start + step) % NATION_ORDER.length];
    if (id && board.nations.find((nation) => nation.id === id)?.government !== null) {
      return id;
    }
  }
  return null;
}

function startFirstTurn(board: Board): Board {
  const first = NATION_ORDER.find((id) => board.nations.find((nation) => nation.id === id)?.government !== null);
  if (!first) {
    return board;
  }
  return beginTurn(board, first);
}

function afterAction(board: Board): string | null {
  if (board.finished || !board.turn) {
    return null;
  }
  if (board.turn.passedInvestor) {
    return beginInvest(board, false);
  }
  board.turn.phase = "confirm";
  return null;
}

function executeRondel(board: Board, index: number, cost: number): string | null {
  const nation = activeNation(board);
  const government = playerAt(board, nation.government ?? -1);
  if (!government || !board.turn) {
    return "That nation has no government.";
  }
  const from = nation.rondelIndex;
  government.cash -= cost;
  nation.rondelIndex = index;
  nation.rondel = `rondel_${index}`;
  board.turn.passedInvestor = from !== null && passesInvestor(from, index);
  const space = RONDEL[index];
  if (space === "taxation") {
    return resolveTaxation(board);
  }
  if (space === "production") {
    return resolveProduction(board);
  }
  if (space === "factory") {
    if (!canBuild(board, nation.id)) {
      return afterAction(board);
    }
    board.turn.phase = "factory";
    return null;
  }
  if (space === "import") {
    board.turn.imported = 0;
    if (!canImport(board)) {
      return afterAction(board);
    }
    board.turn.phase = "import";
    return null;
  }
  if (space === "maneuver") {
    return enterFleets(board);
  }
  return beginInvest(board, true);
}

function chooseRondel(board: Board, index: number): string | null {
  const nation = activeNation(board);
  const cost = rondelCost(nation.rondelIndex, index);
  if (cost === null) {
    return "That rondel move is not allowed.";
  }
  const government = playerAt(board, nation.government ?? -1);
  if (!government) {
    return "That nation has no government.";
  }
  if (government.cash < cost) {
    return "You do not have enough money for that move.";
  }
  if (RONDEL[index] === "investor") {
    const trial = structuredClone(board);
    const payer = playerAt(trial, nation.government ?? -1);
    if (payer) {
      payer.cash -= cost;
    }
    if (!canPayInterest(trial, nation.id)) {
      return "The treasury cannot pay the interest.";
    }
  }
  const from = nation.rondelIndex;
  const passed = from !== null && passesInvestor(from, index);
  if (passed && nation.treasury >= interestOwed(board, nation.id) && board.turn) {
    const voters = board.players.filter((player) => player.swissBank && player.kind === "human").map((player) => player.seat);
    if (voters.length > 0) {
      board.turn.pendingIndex = index;
      board.turn.vetoSeats = voters;
      board.turn.phase = "veto";
      return null;
    }
  }
  return executeRondel(board, index, cost);
}

function resolveTaxation(board: Board): string | null {
  const nation = activeNation(board);
  const government = playerAt(board, nation.government ?? -1);
  if (!government) {
    return "That nation has no government.";
  }
  const revenue = taxRevenue(board, nation.id);
  const previous = TAX_SPACES.indexOf(nation.tax);
  const nextSlot = taxTrack(revenue);
  const nextIndex = TAX_SPACES.indexOf(nextSlot);
  government.cash += Math.max(0, nextIndex - previous);
  nation.tax = nextSlot;
  nation.score += powerPointsForTax(revenue);
  const soldiers = board.units.filter((unit) => unit.nation === nation.id).length;
  const net = revenue - soldiers;
  if (net > 0) {
    nation.treasury += net;
  }
  if (nation.score >= 25) {
    board.finished = true;
    board.turn = null;
    return null;
  }
  return afterAction(board);
}

function resolveProduction(board: Board): string | null {
  const nation = activeNation(board);
  for (const factory of nation.factories) {
    if (hostileArmies(board, factory.region, nation.id)) {
      continue;
    }
    const kind = factory.kind === "sea" ? "fleet" : "army";
    const error = addUnit(board, nation.id, kind, factory.region, kind === "fleet");
    if (error) {
      continue;
    }
  }
  return afterAction(board);
}

function buildFactory(board: Board, region: string | null): string | null {
  if (region === null) {
    return afterAction(board);
  }
  const nation = activeNation(board);
  const site = factorySites(board, nation.id).find((entry) => entry.region === region);
  if (!site) {
    return "A factory cannot be built in that city.";
  }
  if (nation.treasury < 5) {
    return "The treasury does not have 5 million.";
  }
  nation.treasury -= 5;
  nation.factories.push(site);
  return afterAction(board);
}

function importUnit(board: Board, kind: Unit["kind"], region: string): string | null {
  const nation = activeNation(board);
  if (!board.turn || board.turn.imported >= 3) {
    return "Import allows at most three units.";
  }
  if (nation.treasury < 1) {
    return "The treasury does not have 1 million.";
  }
  if (!importSites(board, nation.id, kind).includes(region)) {
    return "That unit cannot be placed there.";
  }
  const error = addUnit(board, nation.id, kind, region, kind === "fleet");
  if (error) {
    return error;
  }
  nation.treasury -= 1;
  board.turn.imported += 1;
  if (board.turn.imported >= 3 || !canImport(board)) {
    return afterAction(board);
  }
  return null;
}

function railReach(board: Board, nation: NationId, origin: string): Set<string> {
  const open = new Set(homes(nation).filter((id) => !hostileArmies(board, id, nation)));
  if (!open.has(origin)) {
    return new Set([origin]);
  }
  const seen = new Set<string>();
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const link of regions.get(current)?.links ?? []) {
      if (open.has(link) && !seen.has(link)) {
        queue.push(link);
      }
    }
  }
  return seen;
}

function convoys(board: Board, nation: NationId, start: string): Set<string> {
  const fleets = board.units.filter((unit) => unit.nation === nation && unit.kind === "fleet" && !unit.harbor);
  const bySea = new Map<string, Unit[]>();
  for (const fleet of fleets) {
    const list = bySea.get(fleet.region) ?? [];
    list.push(fleet);
    bySea.set(fleet.region, list);
  }
  const lands = new Set<string>();
  const seen = new Set<string>();
  const queue: Array<{ sea: string; used: string[] }> = [];
  for (const sea of regions.get(start)?.links ?? []) {
    if (!sea.startsWith("SR")) {
      continue;
    }
    for (const fleet of bySea.get(sea) ?? []) {
      queue.push({ sea, used: [fleet.id] });
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const key = `${current.sea}|${[...current.used].sort().join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const land of regions.get(current.sea)?.links ?? []) {
      if (land.startsWith("LR") && land !== start) {
        lands.add(land);
      }
    }
    for (const sea of regions.get(current.sea)?.links ?? []) {
      if (!sea.startsWith("SR")) {
        continue;
      }
      for (const fleet of bySea.get(sea) ?? []) {
        if (!current.used.includes(fleet.id)) {
          queue.push({ sea, used: [...current.used, fleet.id] });
        }
      }
    }
  }
  return lands;
}

function protectedProvince(board: Board, regionId: string): boolean {
  const owner = regions.get(regionId)?.home;
  if (!owner) {
    return false;
  }
  const nation = board.nations.find((entry) => entry.id === owner);
  if (!nation) {
    return false;
  }
  const unoccupied = nation.factories.filter((factory) => !hostileArmies(board, factory.region, owner));
  return unoccupied.length === 1 && unoccupied[0]?.region === regionId;
}

function armyDestinations(board: Board, unit: Unit): Array<{ region: string; hostileAllowed: boolean }> {
  const starts = railReach(board, unit.nation, unit.region);
  const found = new Set<string>([unit.region]);
  for (const start of starts) {
    found.add(start);
    for (const link of regions.get(start)?.links ?? []) {
      if (link.startsWith("LR")) {
        found.add(link);
      }
    }
    for (const land of convoys(board, unit.nation, start)) {
      found.add(land);
    }
  }
  const expanded = new Set(found);
  for (const region of found) {
    if (regions.get(region)?.home === unit.nation) {
      for (const home of railReach(board, unit.nation, region)) {
        expanded.add(home);
      }
    }
  }
  return [...expanded].map((region) => {
    const foreign = regions.get(region)?.home !== null && regions.get(region)?.home !== unit.nation;
    return { region, hostileAllowed: foreign && !protectedProvince(board, region) };
  });
}

function fleetDestinations(unit: Unit): string[] {
  if (unit.harbor) {
    const port = regions.get(unit.region)?.port;
    return port ? [unit.region, port] : [unit.region];
  }
  const seas = (regions.get(unit.region)?.links ?? []).filter((link) => link.startsWith("SR"));
  return [unit.region, ...seas];
}

function moveUnit(board: Board, unitId: string, region: string, posture?: "hostile" | "friendly"): string | null {
  const turn = board.turn;
  const unit = board.units.find((entry) => entry.id === unitId);
  if (!turn || !unit || unit.nation !== turn.nationId) {
    return "That unit cannot move.";
  }
  if (turn.moved.includes(unitId)) {
    return "That unit has already moved.";
  }
  if (turn.phase === "fleets") {
    if (unit.kind !== "fleet" || !fleetDestinations(unit).includes(region)) {
      return "That fleet cannot move there.";
    }
    if (region !== unit.region) {
      unit.region = region;
      unit.harbor = false;
    }
    turn.moved.push(unitId);
    return null;
  }
  if (turn.phase !== "armies" || unit.kind !== "army") {
    return "That unit cannot move.";
  }
  const destination = armyDestinations(board, unit).find((entry) => entry.region === region);
  if (!destination) {
    return "That army cannot move there.";
  }
  const foreign = regions.get(region)?.home !== null && regions.get(region)?.home !== unit.nation;
  if (foreign) {
    if (posture !== "hostile" && posture !== "friendly") {
      return "Choose whether the army is hostile or friendly.";
    }
    if (posture === "hostile" && !destination.hostileAllowed) {
      return "That factory is the nation's last and cannot be invaded.";
    }
    unit.posture = posture;
  } else {
    unit.posture = "standing";
  }
  unit.region = region;
  turn.moved.push(unitId);
  return null;
}

type BattleMode = "fleet" | "army";

function combatants(board: Board, regionId: string, mode: BattleMode): Unit[] {
  return board.units.filter((unit) => {
    if (mode === "fleet") {
      return unit.kind === "fleet" && !unit.harbor && unit.region === regionId;
    }
    return (unit.kind === "army" && unit.region === regionId) || (unit.kind === "fleet" && unit.harbor && unit.region === regionId);
  });
}

function contested(board: Board, mode: BattleMode): string[] {
  const active = board.turn?.nationId;
  const ids = new Set(combatantsInMode(board, mode).map((unit) => unit.region));
  return [...ids].filter((region) => {
    const owners = new Set(combatants(board, region, mode).map((unit) => unit.nation));
    return owners.size > 1 && active !== undefined && owners.has(active);
  });
}

function combatantsInMode(board: Board, mode: BattleMode): Unit[] {
  return board.units.filter((unit) => (mode === "fleet" ? unit.kind === "fleet" && !unit.harbor : unit.kind === "army" || (unit.kind === "fleet" && unit.harbor)));
}

function modeOf(phase: TurnPhase): BattleMode {
  return phase === "fleet-battle" ? "fleet" : "army";
}

function enterFleets(board: Board): string | null {
  if (!board.turn) {
    return null;
  }
  const fleets = board.units.some((unit) => unit.nation === board.turn?.nationId && unit.kind === "fleet");
  board.turn.moved = [];
  if (!fleets) {
    return enterArmies(board);
  }
  board.turn.phase = "fleets";
  return null;
}

function enterArmies(board: Board): string | null {
  if (!board.turn) {
    return null;
  }
  const armies = board.units.some((unit) => unit.nation === board.turn?.nationId && unit.kind === "army");
  board.turn.moved = [];
  if (!armies) {
    return enterDestroy(board);
  }
  board.turn.phase = "armies";
  return null;
}

function enterBattle(board: Board, mode: BattleMode): string | null {
  if (!board.turn) {
    return null;
  }
  board.turn.battleRegions = contested(board, mode);
  board.turn.battleNations = [];
  board.turn.attackerDone = false;
  if (board.turn.battleRegions.length === 0) {
    return mode === "fleet" ? enterArmies(board) : enterDestroy(board);
  }
  board.turn.phase = mode === "fleet" ? "fleet-battle" : "army-battle";
  return null;
}

function nextBattleRegion(board: Board): string | null {
  const turn = board.turn;
  if (!turn) {
    return null;
  }
  turn.battleRegions.shift();
  turn.battleNations = [];
  turn.attackerDone = false;
  if (turn.battleRegions.length === 0) {
    return turn.phase === "fleet-battle" ? enterArmies(board) : enterDestroy(board);
  }
  return null;
}

function finishAsking(board: Board): string | null {
  const turn = board.turn;
  if (!turn) {
    return null;
  }
  const region = turn.battleRegions[0];
  const mode = modeOf(turn.phase);
  if (!region || !contested(board, mode).includes(region)) {
    return nextBattleRegion(board);
  }
  if (!turn.attackerDone) {
    turn.attackerDone = true;
    turn.battleNations = NATION_ORDER.filter((id) => {
      if (id === turn.nationId) {
        return false;
      }
      const present = combatants(board, region, mode).some((unit) => unit.nation === id);
      const government = board.nations.find((nation) => nation.id === id)?.government;
      return present && government !== null && government !== undefined;
    });
  } else {
    turn.battleNations.shift();
  }
  if (turn.battleNations.length === 0 && turn.attackerDone) {
    return nextBattleRegion(board);
  }
  return null;
}

function fight(board: Board, ownId: string, enemyId: string): string | null {
  const turn = board.turn;
  if (!turn || (turn.phase !== "fleet-battle" && turn.phase !== "army-battle")) {
    return "There is no battle to fight.";
  }
  const region = turn.battleRegions[0];
  const mode = modeOf(turn.phase);
  const own = board.units.find((unit) => unit.id === ownId);
  const enemy = board.units.find((unit) => unit.id === enemyId);
  const actorNation = turn.attackerDone ? turn.battleNations[0] : turn.nationId;
  if (!region || !own || !enemy || own.nation === enemy.nation || own.nation !== actorNation) {
    return "Those units cannot fight.";
  }
  const present = combatants(board, region, mode);
  if (!present.includes(own) || !present.includes(enemy)) {
    return "Those units are not in the same region.";
  }
  board.units = board.units.filter((unit) => unit.id !== ownId && unit.id !== enemyId);
  if (!contested(board, mode).includes(region)) {
    return nextBattleRegion(board);
  }
  return null;
}

function defenderPresent(board: Board, region: string, owner: NationId): boolean {
  return board.units.some(
    (unit) =>
      unit.nation === owner &&
      ((unit.kind === "army" && unit.region === region) || (unit.kind === "fleet" && unit.harbor && unit.region === region)),
  );
}

function destroyTargets(board: Board): string[] {
  const nationId = board.turn?.nationId;
  if (!nationId) {
    return [];
  }
  const regionsWithArmies = new Set(
    board.units.filter((unit) => unit.nation === nationId && unit.kind === "army" && unit.posture === "hostile").map((unit) => unit.region),
  );
  return [...regionsWithArmies].filter((region) => {
    const owner = regions.get(region)?.home;
    if (!owner || owner === nationId) {
      return false;
    }
    const factory = board.nations.find((nation) => nation.id === owner)?.factories.some((entry) => entry.region === region);
    const armies = board.units.filter(
      (unit) => unit.nation === nationId && unit.kind === "army" && unit.posture === "hostile" && unit.region === region,
    ).length;
    return Boolean(factory) && armies >= 3 && !defenderPresent(board, region, owner) && !protectedProvince(board, region);
  });
}

function soleOwner(board: Board, regionId: string): NationId | null {
  const owners = new Set<NationId>();
  for (const unit of board.units) {
    const here =
      (unit.kind === "army" && unit.region === regionId) ||
      (unit.kind === "fleet" && unit.region === regionId);
    if (here) {
      owners.add(unit.nation);
    }
  }
  return owners.size === 1 ? ([...owners][0] ?? null) : null;
}

function updateFlags(board: Board): void {
  const before = board.turn?.checkpoint;
  if (!before) {
    return;
  }
  const ids = new Set<string>([...board.units, ...before.units].map((unit) => unit.region));
  for (const id of ids) {
    if (regions.get(id)?.home) {
      continue;
    }
    const now = soleOwner(board, id);
    const then = soleOwner(before, id);
    if (!now || now === then) {
      continue;
    }
    board.flags = board.flags.filter((flag) => flag.region !== id);
    board.flags.push({ region: id, nation: now });
  }
}

function enterDestroy(board: Board): string | null {
  if (!board.turn) {
    return null;
  }
  if (destroyTargets(board).length === 0) {
    updateFlags(board);
    return afterAction(board);
  }
  board.turn.phase = "destroy";
  return null;
}

function destroyFactory(board: Board, region: string | null): string | null {
  if (region === null) {
    updateFlags(board);
    return afterAction(board);
  }
  if (!destroyTargets(board).includes(region)) {
    return "That factory cannot be destroyed.";
  }
  const owner = regions.get(region)?.home;
  const nation = owner ? board.nations.find((entry) => entry.id === owner) : undefined;
  if (!nation || !board.turn) {
    return "That factory cannot be destroyed.";
  }
  nation.factories = nation.factories.filter((factory) => factory.region !== region);
  const armies = board.units.filter(
    (unit) => unit.nation === board.turn?.nationId && unit.kind === "army" && unit.posture === "hostile" && unit.region === region,
  );
  const removed = new Set(armies.slice(0, 3).map((unit) => unit.id));
  board.units = board.units.filter((unit) => !removed.has(unit.id));
  if (destroyTargets(board).length === 0) {
    updateFlags(board);
    return afterAction(board);
  }
  return null;
}

function investorQueue(board: Board): number[] {
  const holder = board.players.find((player) => player.investor)?.seat;
  if (holder === undefined) {
    return [];
  }
  const queue = [holder];
  for (let step = 1; step < board.players.length; step += 1) {
    const seat = (holder + step) % board.players.length;
    const player = playerAt(board, seat);
    if (player?.swissBank) {
      queue.push(seat);
    }
  }
  return queue;
}

function beginInvest(board: Board, landed: boolean): string | null {
  if (!board.turn) {
    return null;
  }
  if (landed) {
    const error = payInterest(board, activeNation(board).id);
    if (error) {
      return error;
    }
  }
  const holder = board.players.find((player) => player.investor);
  if (holder) {
    holder.cash += 2;
  }
  board.turn.phase = "invest";
  board.turn.investors = investorQueue(board);
  if (board.turn.investors.length === 0) {
    finishInvest(board);
  }
  return null;
}

function buyBond(board: Board, seat: number, nationId: NationId, interest: number, replace: number | null): string | null {
  const price = bondPrice(interest);
  const pile = board.piles[nationId];
  const player = playerAt(board, seat);
  const nation = board.nations.find((entry) => entry.id === nationId);
  if (price === null || !pile?.includes(interest) || !player || !nation) {
    return "That bond has already been taken.";
  }
  if (replace !== null) {
    const held = player.bonds.find((bond) => bond.nation === nationId && bond.interest === replace);
    if (!held) {
      return "You do not hold that bond.";
    }
    if (held.price >= price) {
      return "A bond can only be raised to a higher price.";
    }
    const difference = price - held.price;
    if (player.cash < difference) {
      return "You do not have enough money for that bond.";
    }
    player.cash -= difference;
    nation.treasury += difference;
    pile.push(held.interest);
    pile.splice(pile.indexOf(interest), 1);
    player.bonds = player.bonds.filter((bond) => bond !== held);
    player.bonds.push({ nation: nationId, interest, price });
    return null;
  }
  if (player.cash < price) {
    return "You do not have enough money for that bond.";
  }
  player.cash -= price;
  nation.treasury += price;
  pile.splice(pile.indexOf(interest), 1);
  player.bonds.push({ nation: nationId, interest, price });
  return null;
}

function credit(board: Board, nationId: NationId, seat: number): number {
  return playerAt(board, seat)?.bonds.filter((bond) => bond.nation === nationId).reduce((sum, bond) => sum + bond.price, 0) ?? 0;
}

function refreshGovernments(board: Board): void {
  const holder = board.players.find((player) => player.investor)?.seat ?? 0;
  const order = board.players.map((_, index) => (holder + index) % board.players.length);
  for (const nation of board.nations) {
    let best = 0;
    for (const player of board.players) {
      best = Math.max(best, credit(board, nation.id, player.seat));
    }
    if (best === 0) {
      nation.government = null;
      continue;
    }
    const current = nation.government;
    const currentCredit = current === null ? 0 : credit(board, nation.id, current);
    if (current !== null && best <= currentCredit) {
      continue;
    }
    for (const seat of order) {
      if (credit(board, nation.id, seat) === best) {
        nation.government = seat;
        break;
      }
    }
  }
  const governed = new Set(board.nations.map((nation) => nation.government).filter((seat): seat is number => seat !== null));
  for (const player of board.players) {
    player.swissBank = !governed.has(player.seat);
  }
}

function finishInvest(board: Board): void {
  refreshGovernments(board);
  const holder = board.players.findIndex((player) => player.investor);
  for (const player of board.players) {
    player.investor = false;
  }
  if (holder >= 0) {
    const next = board.players[(holder + 1) % board.players.length];
    if (next) {
      next.investor = true;
    }
  }
  if (board.turn) {
    board.turn.phase = "confirm";
    board.turn.passedInvestor = false;
  }
}

function invest(board: Board, nationId: NationId | null, interest: number | null, replace: number | null): string | null {
  const seat = board.turn?.investors[0];
  if (seat === undefined) {
    return "No bond is being granted.";
  }
  if (nationId !== null && interest !== null) {
    const error = buyBond(board, seat, nationId, interest, replace);
    if (error) {
      return error;
    }
  }
  board.turn?.investors.shift();
  if (board.turn && board.turn.investors.length === 0) {
    finishInvest(board);
  }
  return null;
}

function confirmTurn(board: Board): string | null {
  if (board.turn?.phase !== "confirm") {
    return "Finish the action before confirming.";
  }
  const following = nextNation(board, board.turn.nationId);
  if (!following) {
    board.turn = null;
    return null;
  }
  openTurn(board, following);
  return null;
}

function dispatch(board: Board, command: TurnCommand): string | null {
  const turn = board.turn;
  if (!turn) {
    return "The bond draft is still open.";
  }
  switch (command.action) {
    case "rondel":
      return turn.phase === "rondel" ? chooseRondel(board, command.index) : "Choose a rondel space when it is time.";
    case "veto":
      if (turn.phase !== "veto" || turn.pendingIndex === null) {
        return "The Swiss bank is not deciding.";
      }
      if (command.block) {
        turn.phase = "rondel";
        turn.pendingIndex = null;
        turn.vetoSeats = [];
        return null;
      }
      turn.vetoSeats.shift();
      if (turn.vetoSeats.length === 0 && turn.pendingIndex !== null) {
        const index = turn.pendingIndex;
        turn.pendingIndex = null;
        const cost = rondelCost(activeNation(board).rondelIndex, index) ?? 0;
        return executeRondel(board, index, cost);
      }
      return null;
    case "factory":
      return turn.phase === "factory" ? buildFactory(board, command.region) : "A factory is not being built.";
    case "import":
      return turn.phase === "import" ? importUnit(board, command.kind, command.region) : "Units are not being imported.";
    case "import-done":
      return turn.phase === "import" ? afterAction(board) : "Units are not being imported.";
    case "move":
      return moveUnit(board, command.unitId, command.region, command.posture);
    case "moves-done":
      if (turn.phase === "fleets") {
        return enterBattle(board, "fleet");
      }
      if (turn.phase === "armies") {
        return enterBattle(board, "army");
      }
      return "Units are not moving.";
    case "fight":
      return fight(board, command.ownId, command.enemyId);
    case "peace":
      return turn.phase === "fleet-battle" || turn.phase === "army-battle" ? finishAsking(board) : "There is no battle to decline.";
    case "destroy":
      return turn.phase === "destroy" ? destroyFactory(board, command.region) : "No factory is being destroyed.";
    case "invest":
      return turn.phase === "invest" ? invest(board, command.nationId, command.interest, command.replaceInterest) : "No bond is being granted.";
    case "confirm":
      return confirmTurn(board);
    default:
      return "That action is not available.";
  }
}

function rondelChoices(board: Board): Array<{ index: number; cost: number; space: (typeof RONDEL)[number]; power: number; canBuild: boolean; canProduce: boolean }> {
  const nation = activeNation(board);
  const choices = [];
  for (let index = 0; index < RONDEL.length; index += 1) {
    const cost = rondelCost(nation.rondelIndex, index);
    if (cost === null) {
      continue;
    }
    const space = RONDEL[index];
    if (!space) {
      continue;
    }
    choices.push({
      index,
      cost,
      space,
      power: space === "taxation" ? powerPointsForTax(taxRevenue(board, nation.id)) : 0,
      canBuild: space === "factory" && canBuild(board, nation.id),
      canProduce: space === "production" && canProduce(board, nation.id),
    });
  }
  const from = nation.rondelIndex;
  choices.sort((left, right) => left.cost - right.cost || steps(from, left.index) - steps(from, right.index));
  return choices;
}

function steps(from: number | null, to: number): number {
  if (from === null) {
    return 0;
  }
  return (to - from + RONDEL.length) % RONDEL.length;
}

function investmentChoices(board: Board, seat: number): Array<{ nationId: NationId; interest: number; replaceInterest: number | null; price: number; label: string }> {
  const player = playerAt(board, seat);
  if (!player) {
    return [];
  }
  const choices: Array<{ nationId: NationId; interest: number; replaceInterest: number | null; price: number; label: string }> = [];
  for (const nationId of NATION_ORDER) {
    for (const interest of board.piles[nationId] ?? []) {
      const price = BOND_PRICE[interest];
      if (price === undefined) {
        continue;
      }
      const name = NATION_NAME[nationId];
      if (player.cash >= price) {
        choices.push({ nationId, interest, replaceInterest: null, price, label: `${name} ${price} million` });
      }
      for (const held of player.bonds.filter((bond) => bond.nation === nationId && bond.price < price)) {
        const difference = price - held.price;
        if (player.cash >= difference) {
          choices.push({
            nationId,
            interest,
            replaceInterest: held.interest,
            price: difference,
            label: `Raise ${name} ${held.price} to ${price}`,
          });
        }
      }
    }
  }
  return choices;
}

function aiCommand(board: Board): TurnCommand {
  const turn = board.turn;
  if (!turn) {
    return { action: "confirm" };
  }
  if (turn.phase === "rondel") {
    const choices = rondelChoices(board);
    const taxation = choices.find((choice) => choice.space === "taxation" && choice.power > 0);
    const factory = choices.find((choice) => choice.space === "factory" && choice.canBuild);
    const production = choices.find((choice) => choice.space === "production" && choice.canProduce);
    return { action: "rondel", index: (taxation ?? factory ?? production ?? choices[0])?.index ?? 0 };
  }
  if (turn.phase === "veto") {
    return { action: "veto", block: false };
  }
  if (turn.phase === "factory") {
    return { action: "factory", region: factorySites(board, turn.nationId)[0]?.region ?? null };
  }
  if (turn.phase === "import") {
    const site = importSites(board, turn.nationId, "army")[0];
    if (turn.imported === 0 && site && activeNation(board).treasury >= 1) {
      return { action: "import", kind: "army", region: site };
    }
    return { action: "import-done" };
  }
  if (turn.phase === "fleets" || turn.phase === "armies") {
    return { action: "moves-done" };
  }
  if (turn.phase === "fleet-battle" || turn.phase === "army-battle") {
    return { action: "peace" };
  }
  if (turn.phase === "destroy") {
    return { action: "destroy", region: null };
  }
  if (turn.phase === "invest") {
    const seat = turn.investors[0] ?? 0;
    const choice = investmentChoices(board, seat).sort((left, right) => left.price - right.price)[0];
    if (!choice) {
      return { action: "invest", nationId: null, interest: null, replaceInterest: null };
    }
    return { action: "invest", nationId: choice.nationId, interest: choice.interest, replaceInterest: choice.replaceInterest };
  }
  return { action: "confirm" };
}

export function playAutomatic(board: Board): Board {
  let current = board;
  let nations = 0;
  for (let guard = 0; guard < 80; guard += 1) {
    if (!current.turn || current.finished || current.turn.hold) {
      break;
    }
    const seat = actingSeat(current);
    if (seat === null) {
      break;
    }
    const player = playerAt(current, seat);
    if (!player || player.kind !== "ai") {
      break;
    }
    const command = aiCommand(current);
    const applied = applyTurn(current, seat, command, true);
    if ("error" in applied) {
      break;
    }
    if (command.action === "confirm") {
      nations += 1;
      const nextSeat = actingSeat(applied);
      if (nations >= 6 && nextSeat !== null && playerAt(applied, nextSeat)?.kind === "ai" && applied.turn) {
        applied.turn.hold = true;
      }
    }
    current = applied;
  }
  return current;
}

function applyTurn(board: Board, seat: number, command: TurnCommand, automatic: boolean): Board | { error: string } {
  if (board.finished) {
    return { error: "This game is over." };
  }
  if (command.action === "treasury") {
    return gift(board, seat, command.nationId);
  }
  if (command.action === "continue") {
    if (!board.turn?.hold) {
      return { error: "The game is not waiting." };
    }
    const next = structuredClone(board);
    if (next.turn) {
      next.turn.hold = false;
    }
    return automatic ? next : playAutomatic(next);
  }
  if (!board.turn) {
    return { error: "The bond draft is still open." };
  }
  if (board.turn.hold) {
    return { error: "The game is waiting to continue." };
  }
  if (command.action === "undo") {
    if (governmentSeat(board) !== seat) {
      return { error: "Only the government can undo this turn." };
    }
    const restored = beginTurn(structuredClone(board.turn.checkpoint), board.turn.nationId);
    return automatic ? restored : playAutomatic(restored);
  }
  if (actingSeat(board) !== seat) {
    return { error: "It is not your turn." };
  }
  const next = structuredClone(board);
  const error = dispatch(next, command);
  if (error) {
    return { error };
  }
  return automatic ? next : playAutomatic(next);
}

function gift(board: Board, seat: number, nationId: NationId): Board | { error: string } {
  const nation = board.nations.find((entry) => entry.id === nationId);
  const player = playerAt(board, seat);
  if (!nation || nation.government !== seat) {
    return { error: "You do not lead that government." };
  }
  if (!player || player.cash < 1) {
    return { error: "You do not have a million to spare." };
  }
  const next = structuredClone(board);
  const giver = playerAt(next, seat);
  const treasury = next.nations.find((entry) => entry.id === nationId);
  if (!giver || !treasury) {
    return { error: "You do not lead that government." };
  }
  giver.cash -= 1;
  treasury.treasury += 1;
  const snapshot = next.turn?.checkpoint;
  const savedGiver = snapshot ? playerAt(snapshot, seat) : undefined;
  const savedNation = snapshot?.nations.find((entry) => entry.id === nationId);
  if (savedGiver && savedNation) {
    savedGiver.cash -= 1;
    savedNation.treasury += 1;
  }
  return next;
}

export function performTurn(board: Board, seat: number, command: TurnCommand): Board | { error: string } {
  return applyTurn(board, seat, command, false);
}

export function ensurePlay(board: Board): Board {
  const drafted = playAutomaticDraft(normalizeBoard(board));
  if (drafted.draft || drafted.finished) {
    return drafted;
  }
  if (!drafted.turn) {
    return playAutomatic(startFirstTurn(drafted));
  }
  return playAutomatic(drafted);
}

function choice(label: string, command: TurnCommand): TurnChoice {
  return { label, command };
}

export function describeTurn(board: Board, viewerSeat: number | null): TurnView | null {
  if (!board.turn || board.finished) {
    return null;
  }
  const turn = board.turn;
  const name = NATION_NAME[turn.nationId];
  const actor = actingSeat(board);
  const yours = actor !== null && actor === viewerSeat;
  const leader = playerAt(board, governmentSeat(board) ?? -1);
  const canUndo = governmentSeat(board) === viewerSeat;
  if (turn.hold) {
    return {
      nationId: turn.nationId,
      phase: "hold",
      yours: viewerSeat !== null,
      prompt: "The other governments have taken their turns.",
      choices: [choice("Continue", { action: "continue" })],
      canUndo: false,
      canConfirm: false,
    };
  }
  const base = {
    nationId: turn.nationId,
    phase: turn.phase,
    yours,
    canUndo,
    canConfirm: turn.phase === "confirm" && yours,
    prompt: `${name}'s government${leader?.username ? `, ${leader.username},` : ""} is taking a turn.`,
    choices: [] as TurnChoice[],
  };
  if (!yours) {
    return base;
  }
  if (turn.phase === "rondel") {
    const from = activeNation(board).rondelIndex;
    base.prompt = `${name} chooses a rondel space.`;
    base.choices = rondelChoices(board).map((entry) => {
      const passing = from !== null && passesInvestor(from, entry.index) ? ", passes Investor" : "";
      const cost = entry.cost === 0 ? "free" : `${entry.cost} million`;
      return choice(`${RONDEL_LABEL[entry.index]} · ${cost}${passing}`, { action: "rondel", index: entry.index });
    });
  } else if (turn.phase === "veto") {
    base.prompt = `The Swiss bank may force ${name} to stop on Investor.`;
    base.choices = [choice("Allow the move", { action: "veto", block: false }), choice("Stop on Investor", { action: "veto", block: true })];
  } else if (turn.phase === "factory") {
    base.prompt = `${name} may build one factory for 5 million.`;
    base.choices = [
      ...factorySites(board, turn.nationId).map((site) =>
        choice(`${site.kind === "sea" ? "Shipyard" : "Factory"} in ${regionName(site.region)}`, { action: "factory", region: site.region }),
      ),
      choice("Build nothing", { action: "factory", region: null }),
    ];
  } else if (turn.phase === "import") {
    base.prompt = `${name} may import up to three units for 1 million each. ${turn.imported} bought.`;
    const sites = (kind: Unit["kind"]) =>
      importSites(board, turn.nationId, kind).map((region) =>
        choice(`${kind === "army" ? "Army" : "Fleet"} in ${regionName(region)}`, { action: "import", kind, region }),
      );
    base.choices = [...sites("army"), ...sites("fleet"), choice("Done", { action: "import-done" })];
  } else if (turn.phase === "fleets" || turn.phase === "armies") {
    base.prompt = turn.phase === "fleets" ? `${name} moves fleets, or leaves them in place.` : `${name} moves armies, or leaves them in place.`;
    const units = board.units.filter((unit) => unit.nation === turn.nationId && !turn.moved.includes(unit.id) && (turn.phase === "fleets" ? unit.kind === "fleet" : unit.kind === "army"));
    for (const unit of units) {
      if (unit.kind === "fleet") {
        for (const region of fleetDestinations(unit)) {
          const label = region === unit.region ? `Fleet stays in ${regionName(unit.region)}` : `Fleet from ${regionName(unit.region)} to ${regionName(region)}`;
          base.choices.push(choice(label, { action: "move", unitId: unit.id, region }));
        }
      } else {
        for (const destination of armyDestinations(board, unit)) {
          const foreign = regions.get(destination.region)?.home !== null && regions.get(destination.region)?.home !== unit.nation;
          const staying = destination.region === unit.region;
          const place = regionName(destination.region);
          if (!foreign) {
            base.choices.push(choice(staying ? `Army stays in ${place}` : `Army to ${place}`, { action: "move", unitId: unit.id, region: destination.region }));
          } else if (destination.hostileAllowed) {
            base.choices.push(choice(`Hostile army in ${place}`, { action: "move", unitId: unit.id, region: destination.region, posture: "hostile" }));
            base.choices.push(choice(`Friendly army in ${place}`, { action: "move", unitId: unit.id, region: destination.region, posture: "friendly" }));
          } else {
            base.choices.push(choice(`Friendly army in ${place}`, { action: "move", unitId: unit.id, region: destination.region, posture: "friendly" }));
          }
        }
      }
    }
    base.choices.push(choice(turn.phase === "fleets" ? "Fleets are finished" : "Armies are finished", { action: "moves-done" }));
  } else if (turn.phase === "fleet-battle" || turn.phase === "army-battle") {
    const region = turn.battleRegions[0];
    const mode = modeOf(turn.phase);
    const actorNation = turn.attackerDone ? turn.battleNations[0] : turn.nationId;
    base.prompt = `${NATION_NAME[actorNation ?? turn.nationId]} may fight in ${region ? regionName(region) : "the region"}, or keep the peace.`;
    if (region && actorNation) {
      const present = combatants(board, region, mode);
      for (const own of present.filter((unit) => unit.nation === actorNation)) {
        for (const enemy of present.filter((unit) => unit.nation !== actorNation)) {
          base.choices.push(
            choice(`Fight the ${NATION_NAME[enemy.nation]} ${enemy.kind}`, { action: "fight", ownId: own.id, enemyId: enemy.id }),
          );
        }
      }
    }
    base.choices.push(choice("No battle", { action: "peace" }));
  } else if (turn.phase === "destroy") {
    base.prompt = `${name} may destroy a factory with three hostile armies.`;
    base.choices = [
      ...destroyTargets(board).map((region) => choice(`Destroy the factory in ${regionName(region)}`, { action: "destroy", region })),
      choice("Leave the factories", { action: "destroy", region: null }),
    ];
  } else if (turn.phase === "invest") {
    const seat = turn.investors[0];
    base.prompt = seat === viewerSeat ? "Grant one bond, or pass. The price goes into that treasury." : "A bond may be granted.";
    if (seat !== undefined) {
      base.choices = [
        ...investmentChoices(board, seat).map((entry) =>
          choice(entry.label, { action: "invest", nationId: entry.nationId, interest: entry.interest, replaceInterest: entry.replaceInterest }),
        ),
        choice("Pass", { action: "invest", nationId: null, interest: null, replaceInterest: null }),
      ];
    }
  } else if (turn.phase === "confirm") {
    base.prompt = `${name}'s turn is ready to store.`;
    base.choices = [choice("Confirm", { action: "confirm" })];
  }
  return base;
}

export function victoryPoints(board: Board, seat: number): number {
  const player = playerAt(board, seat);
  if (!player) {
    return 0;
  }
  const fromBonds = player.bonds.reduce((sum, bond) => {
    const score = board.nations.find((nation) => nation.id === bond.nation)?.score ?? 0;
    return sum + bond.interest * scoreFactor(score);
  }, 0);
  return fromBonds + player.cash;
}

export function scoreboard(board: Board): Array<{ seat: number; points: number; winner: boolean }> {
  const seats = board.players.map((player) => player.seat);
  const ranked = [...seats].sort((left, right) => compareScore(board, left, right));
  const best = ranked[0];
  const tied = best === undefined || (ranked[1] !== undefined && compareScore(board, best, ranked[1]) === 0);
  return seats.map((seat) => ({ seat, points: victoryPoints(board, seat), winner: !tied && seat === best }));
}

function compareScore(board: Board, left: number, right: number): number {
  const points = victoryPoints(board, right) - victoryPoints(board, left);
  if (points !== 0) {
    return points;
  }
  const nations = [...board.nations].sort((a, b) => b.score - a.score || NATION_ORDER.indexOf(a.id) - NATION_ORDER.indexOf(b.id));
  for (const nation of nations) {
    const difference = credit(board, nation.id, right) - credit(board, nation.id, left);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export type { BondHolding };
