import { bondPrice, NATION_NAME } from "./constants.js";
import { appendLog } from "./log.js";
import { regions } from "./map.js";
import type { Board, TurnCommand } from "./turn.js";

const RONDEL_NAMES = ["Taxation", "Factory", "Production", "Maneuver", "Investor", "Import", "Production", "Maneuver"];
const place = (id: string) => regions.get(id)?.name ?? id;
const playerName = (board: Board, seat: number | null) => board.players.find((player) => player.seat === seat)?.username ?? `Player ${(seat ?? 0) + 1}`;

export function recordTurn(before: Board, after: Board, seat: number, command: TurnCommand): void {
  const player = playerName(before, seat);
  const nationId = command.action === "treasury" ? command.nationId : before.turn?.nationId;
  const nation = nationId ? NATION_NAME[nationId] : "The country";
  let text: string;
  switch (command.action) {
    case "rondel": text = `${player} chose ${RONDEL_NAMES[command.index]} for ${nation}.`; break;
    case "veto": text = `${player} ${command.block ? `forced ${nation} to stop on Investor` : `allowed ${nation}'s rondel move`}.`; break;
    case "factory": text = command.region ? `${player}: ${nation} built a factory in ${place(command.region)}.` : `${player}: ${nation} built no factory.`; break;
    case "import": text = `${player}: ${nation} imported ${command.kind === "army" ? "an army" : "a fleet"} in ${place(command.region)}.`; break;
    case "import-done": text = `${player}: ${nation} finished importing units.`; break;
    case "move": {
      const unit = before.units.find((entry) => entry.id === command.unitId);
      text = `${player}: ${nation}'s ${unit?.kind ?? "unit"} ${unit?.region === command.region ? `stayed in ${place(command.region)}` : `moved from ${place(unit?.region ?? "unknown")} to ${place(command.region)}`}${command.posture ? ` (${command.posture})` : ""}.`;
      break;
    }
    case "moves-done": text = `${player}: ${nation} finished moving ${before.turn?.phase === "fleets" ? "fleets" : "armies"}.`; break;
    case "fight": {
      const own = before.units.find((unit) => unit.id === command.ownId);
      const enemy = before.units.find((unit) => unit.id === command.enemyId);
      text = `${player}: ${own ? NATION_NAME[own.nation] : nation} fought ${enemy ? NATION_NAME[enemy.nation] : "the enemy"} in ${place(own?.region ?? "unknown")}.`;
      break;
    }
    case "peace": text = `${player} chose no battle in ${place(before.turn?.battleRegions[0] ?? "unknown")}.`; break;
    case "destroy": text = command.region ? `${player}: ${nation} destroyed the factory in ${place(command.region)}.` : `${player}: ${nation} left the factories intact.`; break;
    case "invest": {
      if (command.nationId === null || command.interest === null) {
        text = `${player} passed on buying a bond.`;
      } else {
        const price = bondPrice(command.interest) ?? 0;
        const oldPrice = command.replaceInterest === null ? 0 : bondPrice(command.replaceInterest) ?? 0;
        text = `${player} ${command.replaceInterest === null ? "bought" : "upgraded to"} a ${NATION_NAME[command.nationId]} bond worth ${price} million (${command.interest} million interest), paying ${price - oldPrice} million.`;
      }
      break;
    }
    case "confirm": text = `${player} ended ${nation}'s turn.`; break;
    case "undo": text = `${player} undid ${nation}'s turn and returned to choosing its rondel move.`; break;
    case "continue": text = `${player} continued the game.`; break;
    case "treasury": text = `${player} transferred 1 million to ${nation}'s treasury.`; break;
  }
  const details: string[] = [];
  if (command.action !== "undo") {
    for (const current of after.nations) {
      const previous = before.nations.find((entry) => entry.id === current.id);
      if (!previous) continue;
      if (current.treasury !== previous.treasury) details.push(`${NATION_NAME[current.id]} treasury: ${previous.treasury} → ${current.treasury} million.`);
      if (current.score !== previous.score) details.push(`${NATION_NAME[current.id]} power: ${previous.score} → ${current.score}.`);
      if (current.government !== previous.government) details.push(`${NATION_NAME[current.id]} is now controlled by ${current.government === null ? "no player" : playerName(after, current.government)}.`);
    }
    const created = after.units.filter((unit) => !before.units.some((entry) => entry.id === unit.id));
    const removed = before.units.filter((unit) => !after.units.some((entry) => entry.id === unit.id));
    if (created.length && command.action === "rondel") details.push(`Produced: ${created.map((unit) => `${NATION_NAME[unit.nation]} ${unit.kind} in ${place(unit.region)}`).join(", ")}.`);
    if (removed.length) details.push(`Removed: ${removed.map((unit) => `${NATION_NAME[unit.nation]} ${unit.kind} in ${place(unit.region)}`).join(", ")}.`);
    for (const flag of after.flags) {
      if (!before.flags.some((entry) => entry.region === flag.region && entry.nation === flag.nation)) {
        details.push(`${NATION_NAME[flag.nation]} claimed ${place(flag.region)}.`);
      }
    }
    if (before.turn?.phase !== "invest" && after.turn?.phase === "invest") {
      const holder = before.players.find((entry) => entry.investor);
      if (holder) details.push(`${playerName(before, holder.seat)} received the 2 million Investor bonus.`);
      const current = after.nations.find((entry) => entry.id === nationId);
      if (current?.rondelIndex === 4) {
        for (const bondholder of before.players) {
          const interest = bondholder.bonds.filter((bond) => bond.nation === nationId).reduce((sum, bond) => sum + bond.interest, 0);
          if (interest) details.push(`${nation} paid ${playerName(before, bondholder.seat)} ${interest} million interest.`);
        }
      }
    }
    const oldInvestor = before.players.find((entry) => entry.investor);
    const newInvestor = after.players.find((entry) => entry.investor);
    if (newInvestor && newInvestor.seat !== oldInvestor?.seat) details.push(`${playerName(after, newInvestor.seat)} received the Investor card.`);
    if (!before.finished && after.finished) details.push("The game is over.");
  }
  appendLog(after, [text, ...details].join(" "));
}
