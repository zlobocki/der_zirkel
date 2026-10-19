import { powerPointsForTax, scoreFactor, type NationId } from "./constants.js";
import { regions } from "./map.js";
import type { Board, TurnCommand } from "./turn.js";

type SearchRules = {
  choices: (board: Board, seat: number) => TurnCommand[];
  preview: (board: Board, command: TurnCommand) => Board | null;
  actor: (board: Board) => number | null;
};
const startingCash: Record<number, number> = { 1: 40, 2: 40, 3: 28, 4: 22, 5: 18, 6: 15 };
const land = [...regions.values()].filter((region) => region.kind === "land");
const distances = new Map<string, Map<string, number>>();
for (const start of land) {
  const found = new Map([[start.id, 0]]);
  const queue = [start.id];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of regions.get(current)?.links ?? []) {
      if (regions.get(next)?.kind === "land" && !found.has(next)) {
        found.set(next, found.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  distances.set(start.id, found);
}

/** Opponents' private cash must never influence the policy or its rollouts. */
export function aiView(board: Board, seat: number): Board {
  const copy = structuredClone({ ...board, log: [], turn: board.turn ? { ...board.turn, checkpoint: { ...board.turn.checkpoint, log: [], turn: null } } : null });
  for (const player of copy.players) {
    if (player.seat !== seat) {
      const invested = player.bonds.reduce((sum, bond) => sum + bond.price, 0);
      player.cash = Math.max(8, (startingCash[copy.players.length] ?? 20) - invested);
    }
  }
  // Checkpoints are irrelevant to the search, and may contain private cash too.
  if (copy.turn) copy.turn.checkpoint = { ...copy, turn: null, log: [] };
  return copy;
}

type Outlook = { rounds: number; horizon: number };
function outlookFor(board: Board): Outlook {
  const leadingPower = Math.max(...board.nations.map((nation) => nation.score));
  const pace = Math.max(2, ...board.nations.map((nation) => powerPointsForTax(nation.factories.length * 2 + board.flags.filter((flag) => flag.nation === nation.id).length)));
  return { rounds: Math.max(0.3, Math.min(7, (25 - leadingPower) / pace)), horizon: Math.min(0.8, Math.max(0.1, (25 - leadingPower) / 25)) };
}

/** All terms are measured approximately in millions of personal end-game value. */
export function evaluateAIPosition(board: Board, seat: number, outlook = outlookFor(board)): number {
  const flags = new Map(board.flags.map((flag) => [flag.region, flag.nation]));
  const byRegion = new Map<string, Board["units"]>();
  for (const unit of board.units) {
    const here = byRegion.get(unit.region) ?? [];
    here.push(unit);
    byRegion.set(unit.region, here);
  }
  // Credit captures immediately, before the rules commit flags at maneuver end.
  for (const [id, units] of byRegion) {
    if (!regions.get(id)?.home && new Set(units.map((unit) => unit.nation)).size === 1) flags.set(id, units[0].nation);
  }
  const revenues = new Map<NationId, number>();
  const factories = new Map<NationId, number>();
  for (const nation of board.nations) {
    const open = nation.factories.filter((factory) => !(byRegion.get(factory.region) ?? []).some((unit) => unit.kind === "army" && unit.posture === "hostile" && unit.nation !== nation.id)).length;
    factories.set(nation.id, open);
    revenues.set(nation.id, Math.min(25, open * 2 + [...flags.values()].filter((id) => id === nation.id).length));
  }
  const { rounds, horizon } = outlook;
  const strengths = new Map<NationId, number>();
  for (const nation of board.nations) {
    const units = board.units.filter((unit) => unit.nation === nation.id);
    const targets = land.filter((region) => !region.home && flags.get(region.id) !== nation.id);
    let strength = (factories.get(nation.id) ?? 0) * 3 + (revenues.get(nation.id) ?? 0) * 1.7 + Math.min(12, nation.treasury) * 0.16;
    const stacks = new Map<string, number>();
    for (const unit of units) {
      const stack = stacks.get(unit.region) ?? 0;
      stacks.set(unit.region, stack + 1);
      let position = 0;
      if (unit.kind === "army") {
        // An army at home can start from any connected, unblocked home province
        // by rail. Ignoring that made wandering into a neighbour look like progress.
        const origins = new Set([unit.region]);
        if (regions.get(unit.region)?.home === nation.id) {
          const queue = [unit.region];
          for (let index = 0; index < queue.length; index += 1) {
            const here = queue[index];
            if ((byRegion.get(here) ?? []).some((other) => other.kind === "army" && other.nation !== nation.id && other.posture === "hostile")) continue;
            for (const next of regions.get(here)?.links ?? []) {
              if (origins.has(next) || regions.get(next)?.home !== nation.id
                || (byRegion.get(next) ?? []).some((other) => other.kind === "army" && other.nation !== nation.id && other.posture === "hostile")) continue;
              origins.add(next);
              queue.push(next);
            }
          }
        }
        const distance = Math.min(8, ...[...origins].flatMap((origin) => targets.map((target) => distances.get(origin)?.get(target.id) ?? 8)));
        position = targets.length ? (8 - distance) * 0.35 : 0;
        // A friendly army abroad earns no flag and blocks no factory, yet still
        // costs upkeep and can be attacked. Prefer captures, defence or occupation.
        if (regions.get(unit.region)?.home && regions.get(unit.region)?.home !== nation.id && unit.posture === "friendly") position -= 0.8;
        if (!regions.get(unit.region)?.home && flags.get(unit.region) === nation.id) position += 0.7;
        if (regions.get(unit.region)?.home === nation.id) {
          const threat = (regions.get(unit.region)?.links ?? []).some((id) => (byRegion.get(id) ?? []).some((other) => other.kind === "army" && other.nation !== nation.id));
          if (threat) position += 0.8;
        }
      } else if (!unit.harbor) {
        position = 1.1 + (flags.get(unit.region) === nation.id ? 0.5 : 0);
        const coasts = (regions.get(unit.region)?.links ?? []).filter((id) => regions.get(id)?.kind === "land");
        if (coasts.some((id) => targets.some((target) => target.id === id))) position += 0.8;
      }
      // Spare troops have upkeep costs; dispersed forces are worth more than piles.
      strength += Math.max(0.1, 1.2 - units.length * 0.055) + position / (1 + stack * 2);
      const enemies = (byRegion.get(unit.region) ?? []).filter((other) => other.nation !== nation.id);
      if (enemies.length > stack + 1) strength -= 0.6;
    }
    strengths.set(nation.id, strength);
  }
  const values = board.players.map((player) => {
    let value = player.cash;
    for (const nation of board.nations) {
      const held = player.bonds.filter((bond) => bond.nation === nation.id);
      const interest = held.reduce((sum, bond) => sum + bond.interest, 0);
      const credit = held.reduce((sum, bond) => sum + bond.price, 0);
      const competitors = board.players.filter((entry) => entry.seat !== player.seat);
      const rivalCredit = Math.max(0, ...competitors.map((other) => other.bonds.filter((bond) => bond.nation === nation.id).reduce((sum, bond) => sum + bond.price, 0)));
      const rivalInterest = Math.max(0, ...competitors.map((other) => other.bonds.filter((bond) => bond.nation === nation.id).reduce((sum, bond) => sum + bond.interest, 0)));
      const totalInterest = board.players.flatMap((entry) => entry.bonds).filter((bond) => bond.nation === nation.id).reduce((sum, bond) => sum + bond.interest, 0);
      const projectedPower = Math.min(25, nation.score + rounds * Math.max(1, powerPointsForTax(revenues.get(nation.id) ?? 0)) * 0.7);
      const multiplier = board.finished ? scoreFactor(nation.score) : scoreFactor(nation.score) * (1 - horizon) + scoreFactor(projectedPower) * horizon;
      const solvency = Math.min(1, (nation.treasury + (revenues.get(nation.id) ?? 0) * 0.4) / Math.max(1, totalInterest));
      value += interest * (multiplier + (board.finished ? 0 : rounds * 0.45 * solvency));
      if (!board.finished) value += interest * nation.score * 0.025;
      if (!board.finished) {
        const influence = Math.max(-0.5, Math.min(1, (interest - rivalInterest * 0.5) / Math.max(1, totalInterest)));
        value += (strengths.get(nation.id) ?? 0) * influence * 0.8;
        const controls = credit > 0 && (credit > rivalCredit || (credit === rivalCredit && nation.government === player.seat));
        if (controls) value += 2.5 + Math.min(4, (strengths.get(nation.id) ?? 0) * 0.15);
      }
    }
    return { seat: player.seat, value };
  });
  const own = values.find((player) => player.seat === seat)?.value ?? 0;
  const rivals = values.filter((player) => player.seat !== seat).map((player) => player.value);
  const rival = Math.max(0, ...rivals);
  const relative = own - rival * 0.55 - rivals.reduce((sum, value) => sum + value, 0) * 0.05;
  // Finish immediately when ahead; avoid handing a rival an estimated victory.
  return board.finished ? relative + (own > rival ? 10000 : own < rival ? -10000 : 0) : relative;
}

export function selectAICommand(board: Board, seat: number, rules: SearchRules): TurnCommand {
  const view = aiView(board, seat);
  const candidates = rules.choices(view, seat);
  if (!candidates.length) return { action: "confirm" };
  let budget = board.turn?.phase === "rondel" ? 650 : 200;
  // Keep the same horizon for all branches. Re-estimating it after each tax
  // would perversely reward delaying the game to collect imaginary interest.
  const outlook = outlookFor(view);
  const evaluate = (position: Board) => evaluateAIPosition(position, seat, outlook);
  function ranked(position: Board, commands: TurnCommand[]) {
    const scored: Array<{ command: TurnCommand; next: Board; score: number }> = [];
    for (const command of commands) {
      if (--budget < 0) break;
      const next = rules.preview(position, command);
      if (!next) continue;
      let score = evaluate(next);
      // Passing and leaving units in place win ties over pointless movement.
      if (command.action === "move" && position.units.find((unit) => unit.id === command.unitId)?.region !== command.region) score -= 0.04;
      if (command.action === "move" && command.posture === "friendly"
        && position.units.find((unit) => unit.id === command.unitId)?.region !== command.region) score -= 0.4;
      if (command.action === "rondel") score -= ((command.index - (position.nations.find((nation) => nation.id === position.turn?.nationId)?.rondelIndex ?? command.index) + 8) % 8) * 0.015;
      scored.push({ command, next, score });
    }
    return scored.sort((left, right) => right.score - left.score);
  }
  const initial = ranked(view, candidates);
  if (!initial.length) return candidates[0];
  if (board.turn?.phase !== "rondel") return initial[0].command;
  // Compare economic actions with a completed maneuver, not with an empty phase.
  const shortlist = initial.slice(0, 3);
  const maneuver = initial.find((entry) => entry.command.action === "rondel" && (entry.command.index === 3 || entry.command.index === 7));
  if (maneuver && !shortlist.includes(maneuver)) shortlist.push(maneuver);
  const rolloutBudget = Math.max(40, Math.floor(budget / shortlist.length));
  for (const entry of shortlist) {
    budget = rolloutBudget;
    let current = entry.next;
    for (let depth = 0; depth < 16 && budget > 0; depth += 1) {
      if (current.finished || current.turn?.nationId !== view.turn?.nationId || current.turn?.phase === "confirm" || current.turn?.phase === "rondel" || rules.actor(current) !== seat) break;
      const choices = rules.choices(current, seat);
      const next = ranked(current, choices)[0];
      if (!next) break;
      current = next.next;
    }
    entry.score = evaluate(current);
  }
  return shortlist.sort((left, right) => right.score - left.score)[0].command;
}
