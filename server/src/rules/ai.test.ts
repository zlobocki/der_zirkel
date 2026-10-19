import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { ARMY_CAP, FLEET_CAP, NATION_ORDER, powerPointsForTax, type NationId } from "./constants.js";
import { actorSeat, chooseBond, chooseDraftBond, openingPiles } from "./draft.js";
import { regions } from "./map.js";
import { actingSeat, chooseAICommand, describeTurn, ensurePlay, nationTaxation, performTurn, scoreboard, type Board, type TurnCommand } from "./turn.js";

const cities: Record<NationId, string[]> = { ah: ["LR14", "LR16"], ita: ["LR44", "LR45"], fra: ["LR3", "LR7"], uk: ["LR36", "LR37"], ger: ["LR11", "LR12"], rus: ["LR21", "LR24"] };
const ports = new Set(["LR45", "LR3", "LR36", "LR37", "LR11", "LR24"]);
function table(): Board {
  const piles = openingPiles();
  for (const id of NATION_ORDER) piles[id] = piles[id].filter((interest) => interest !== 4);
  return ensurePlay({
    piles, draft: null, turn: null, finished: false, nextUnit: 1, units: [], flags: [],
    players: [0, 1].map((seat) => ({ seat, username: `Player ${seat + 1}`, userId: `user-${seat}`, kind: "human", cash: 13, investor: seat === 1, swissBank: false,
      bonds: NATION_ORDER.filter((_, index) => index % 2 === seat).map((nation) => ({ nation, interest: 4, price: 9 })) })),
    nations: NATION_ORDER.map((id, index) => ({ id, score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 9, government: index % 2,
      factories: cities[id].map((region) => ({ region, kind: ports.has(region) ? "sea" : "land" })) })),
  });
}
function advanced(board = table()): Board {
  board.nations.forEach((nation) => { nation.score = 24; });
  return board;
}
function apply(board: Board, command: TurnCommand): Board {
  const seat = actingSeat(board);
  if (seat === null) throw new Error("No actor");
  const next = performTurn(board, seat, command);
  if ("error" in next) throw new Error(`${JSON.stringify(command)}: ${next.error}`);
  return next;
}

describe("strategic AI decisions", () => {
  function closingCountry(index: number, cash = 10): Board {
    const board = table();
    board.nations[0].score = 22;
    board.nations[0].rondelIndex = index;
    board.nations[0].rondel = `rondel_${index}`;
    board.nations[0].treasury = 20;
    board.players[0].cash = cash;
    board.players[0].investor = true;
    board.players[1].investor = false;
    board.flags = ["LR28", "LR30", "SR3", "SR4"].map(region => ({ region, nation: "ah" }));
    return board;
  }

  it.each([0, 1])("takes the Investor shortcut from rondel space %s when the next taxation can end the game", (index) => {
    let board = closingCountry(index);
    expect(chooseAICommand(board)).toEqual({ action: "rondel", index: 4 });
    board = apply(board, chooseAICommand(board));
    expect(board.turn?.phase).toBe("interest");
    board = apply(board, { action: "confirm-interest" });
    board = apply(board, { action: "invest", nationId: null, interest: null, replaceInterest: null });
    // Simulate the other countries finishing their turns without changing the economy.
    board.turn!.nationId = "ah";
    board.turn!.phase = "rondel";
    expect(chooseAICommand(board)).toEqual({ action: "rondel", index: 0 });
    const finished = apply(board, chooseAICommand(board));
    expect(finished.finished).toBe(true);
    expect(scoreboard(finished).find(player => player.seat === 0)?.winner).toBe(true);
  });

  it("takes a paid winning taxation immediately when it can already be reached", () => {
    const board = closingCountry(2);
    expect(chooseAICommand(board)).toEqual({ action: "rondel", index: 0 });
    const finished = apply(board, chooseAICommand(board));
    expect(finished.players[0].cash).toBe(10 - 6 + 3);
    expect(finished.finished).toBe(true);
  });

  it("keeps enough personal cash after investing to pay for the finishing jump to Taxation", () => {
    let board = closingCountry(1, 0);
    board.piles = { ah: [3], ita: [], fra: [], uk: [], ger: [], rus: [] };
    board = apply(board, { action: "rondel", index: 4 });
    board = apply(board, { action: "confirm-interest" });
    expect(board.players[0].cash).toBe(6);
    expect(chooseAICommand(board)).toEqual({ action: "invest", nationId: null, interest: null, replaceInterest: null });
  });

  it("respects the interest shortfall when the Investor shortcut is unaffordable", () => {
    const board = closingCountry(0, 2);
    board.nations[0].treasury = 0;
    board.players[1].bonds = [{ nation: "ah", interest: 4, price: 9 }];
    const choices = describeTurn(board, 0)!.choices.map(choice => choice.command);
    expect(choices).not.toContainEqual({ action: "rondel", index: 4 });
    const command = chooseAICommand(board);
    expect(choices).toContainEqual(command);
    expect(command).not.toEqual({ action: "rondel", index: 4 });
    expect(apply(board, command)).not.toHaveProperty("error");
  });

  it("rechecks tax revenue after a loss of territory instead of pursuing an obsolete finish", () => {
    const board = closingCountry(4);
    board.flags = [];
    expect(nationTaxation(board, "ah")).toBe(4);
    expect(chooseAICommand(board)).not.toEqual({ action: "rondel", index: 0 });
  });

  it("does not use an opponent's hidden cash when choosing the finishing route", () => {
    const board = closingCountry(0);
    const before = JSON.stringify(board);
    const command = chooseAICommand(board);
    expect(command).toEqual({ action: "rondel", index: 4 });
    expect(JSON.stringify(board)).toBe(before);
    board.players[1].cash = 1000000;
    expect(chooseAICommand(board)).toEqual(command);
  });

  it("moves an army to claim territory rather than ending the maneuver", () => {
    const board = table();
    board.turn!.phase = "armies";
    board.units = [{ id: "army", nation: "ah", kind: "army", region: "LR14", harbor: false, posture: "standing" }];
    const command = chooseAICommand(board);
    expect(command.action).toBe("move");
    expect(command).not.toMatchObject({ region: "LR14" });
    expect(command).not.toMatchObject({ posture: "friendly" });
    const result = apply(board, command);
    expect(result.units[0].region).not.toBe("LR14");
    expect(board.units[0].region).toBe("LR14");
  });

  it("avoids pointless friendly incursions from home and prefers a useful neutral capture", () => {
    for (const region of ["LR14", "LR16", "LR18", "LR15", "LR17"]) {
      const board = table();
      board.turn!.phase = "armies";
      board.units = [{ id: "army", nation: "ah", kind: "army", region, harbor: false, posture: "standing" }];
      const command = chooseAICommand(board);
      expect(command.action).toBe("move");
      if (command.action !== "move") throw new Error("Expected expansion");
      expect(regions.get(command.region)?.home).toBeNull();
    }
  });

  it("fights a profitable battle and declines a losing exchange", () => {
    const board = table();
    board.turn!.phase = "army-battle";
    board.turn!.battleRegions = ["LR8"];
    board.units = [
      ...["a", "b"].map((id) => ({ id, nation: "ah" as const, kind: "army" as const, region: "LR8", harbor: false, posture: "standing" as const })),
      { id: "enemy", nation: "ita", kind: "army", region: "LR8", harbor: false, posture: "standing" },
    ];
    expect(chooseAICommand(board).action).toBe("fight");
    board.units = [board.units[0], ...["c", "d", "e"].map((id) => ({ ...board.units[2], id }))];
    expect(chooseAICommand(board).action).toBe("peace");
  });

  it("captures a neutral country before occupying an unguarded rival factory", () => {
    const board = table();
    board.turn!.phase = "armies";
    board.nations.forEach((nation) => { nation.score = 10; nation.treasury = 20; });
    board.nations.find((nation) => nation.id === "ger")!.government = 1;
    board.players[0].bonds = [{ nation: "ah", interest: 4, price: 9 }];
    board.players[1].bonds = [{ nation: "ger", interest: 5, price: 12 }];
    board.units = [{ id: "army", nation: "ah", kind: "army", region: "LR14", harbor: false, posture: "standing" }];
    const command = chooseAICommand(board);
    expect(command.action).toBe("move");
    if (command.action !== "move") throw new Error("Expected neutral expansion");
    expect(regions.get(command.region)?.home).toBeNull();
  });

  it("taxes an established economy instead of delaying collection to build more", () => {
    const board = table();
    const nation = board.nations[0];
    nation.score = 10;
    nation.treasury = 20;
    nation.tax = "tax_10";
    nation.rondel = "rondel_7";
    nation.rondelIndex = 7;
    board.flags = ["LR28", "LR30", "LR29", "SR3", "SR4", "SR5"].map(region => ({ region, nation: "ah" }));
    board.units = [{ id: "army", nation: "ah", kind: "army", region: "LR14", harbor: false, posture: "standing" }];
    expect(chooseAICommand(board)).toEqual({ action: "rondel", index: 0 });
  });

  it("still blocks a rival's factory when that stops an imminent winning taxation", () => {
    const board = table();
    board.turn!.phase = "armies";
    board.nations.find((nation) => nation.id === "ger")!.government = 1;
    board.nations.find((nation) => nation.id === "ger")!.score = 24;
    board.players[0].bonds = [{ nation: "ah", interest: 4, price: 9 }];
    board.players[1].bonds = [{ nation: "ger", interest: 5, price: 12 }];
    board.flags = [...regions.values()].filter(region => !region.home).map(region => ({ region: region.id, nation: ["LR9", "LR25"].includes(region.id) ? "ger" : "ah" }));
    board.units = [{ id: "army", nation: "ah", kind: "army", region: "LR14", harbor: false, posture: "standing" }];
    expect(chooseAICommand(board)).toMatchObject({ action: "move", region: "LR12", posture: "hostile" });
  });

  it("spreads fleets into unclaimed seas instead of stacking in an already claimed sea", () => {
    const board = table();
    board.turn!.phase = "fleets";
    board.flags = [{ region: "SR3", nation: "ah" }];
    board.units = ["fleet1", "fleet2"].map(id => ({ id, nation: "ah", kind: "fleet", region: "SR3", harbor: false, posture: "standing" }));
    for (let step = 0; step < 2; step += 1) {
      const command = chooseAICommand(board);
      expect(command.action).toBe("move");
      if (command.action !== "move") throw new Error("Expected sea expansion");
      expect(command.region).not.toBe("SR3");
      const result = apply(board, command);
      board.units = result.units;
      board.turn = result.turn;
    }
    expect(new Set(board.units.map(unit => unit.region)).size).toBe(2);
  });

  it("evaluates a defensive battle for the defending government's owner", () => {
    const board = table();
    board.turn!.nationId = "ita";
    board.turn!.phase = "army-battle";
    board.turn!.battleRegions = ["LR8"];
    board.turn!.battleNations = ["ah"];
    board.turn!.attackerDone = true;
    board.turn!.battleResume = "armies";
    board.units = [
      ...["a", "b"].map((id) => ({ id, nation: "ah" as const, kind: "army" as const, region: "LR8", harbor: false, posture: "standing" as const })),
      { id: "invader", nation: "ita", kind: "army", region: "LR8", harbor: false, posture: "friendly" },
    ];
    expect(actingSeat(board)).toBe(0);
    expect(chooseAICommand(board)).toMatchObject({ action: "fight", ownId: "a", enemyId: "invader" });
    board.units = [board.units[0], ...["c", "d", "e"].map((id) => ({ ...board.units[2], id }))];
    expect(chooseAICommand(board).action).toBe("peace");
  });

  it("buys the valuable late-game bond rather than the cheapest losing-country bond", () => {
    const board = advanced();
    board.nations.find((nation) => nation.id === "fra")!.score = 0;
    board.turn!.phase = "invest";
    board.turn!.investors = [0, 1];
    board.piles = { ah: [], ita: [], fra: [1], uk: [], ger: [4], rus: [] };
    board.players[0].cash = 10;
    expect(chooseAICommand(board)).toMatchObject({ action: "invest", nationId: "ger", interest: 4 });
  });

  it("keeps cash instead of buying a worthless bond as the game nears its end", () => {
    const board = advanced();
    board.nations.find((nation) => nation.id === "fra")!.score = 0;
    board.turn!.phase = "invest";
    board.turn!.investors = [0, 1];
    board.piles = { ah: [], ita: [], fra: [9], uk: [], ger: [], rus: [] };
    board.players[0].cash = 40;
    expect(chooseAICommand(board)).toMatchObject({ action: "invest", nationId: null, interest: null });
  });

  it("finishes a winning game and avoids immediately finishing a losing one", () => {
    const board = advanced();
    board.nations[0].factories.push({ region: "LR15", kind: "land" });
    board.players[0].cash = 100;
    expect(chooseAICommand(board)).toEqual({ action: "rondel", index: 0 });
    board.players[0].cash = 0;
    board.players[0].bonds = [{ nation: "ah", interest: 1, price: 2 }];
    board.players[1].bonds = [{ nation: "fra", interest: 9, price: 30 }];
    expect(chooseAICommand(board)).not.toEqual({ action: "rondel", index: 0 });
  });

  it("does not use another player's hidden cash or change the live board", () => {
    const board = table();
    const original = JSON.stringify(board);
    const first = chooseAICommand(board);
    expect(JSON.stringify(board)).toBe(original);
    board.players[1].cash = 1000000;
    expect(chooseAICommand(board)).toEqual(first);
  });

  it("drafts useful bonds while keeping a budget for other countries", () => {
    const board = table();
    board.draft = { nationIndex: 0, offerIndex: 0 };
    board.players[0].cash = 28;
    board.players.forEach((player) => { player.bonds = []; });
    const choice = chooseDraftBond(board, 0);
    expect(choice).not.toBeNull();
    expect(choice).toBeGreaterThan(1);
  });

  it("hands mixed human/AI tables back to the human or an actionable Continue prompt", () => {
    for (const count of [3, 6]) {
      let board = table();
      board.turn = null;
      board.draft = { nationIndex: 0, offerIndex: 0 };
      board.piles = openingPiles();
      board.players = Array.from({ length: count }, (_, seat) => ({ seat, userId: seat ? null : "human", username: `Player ${seat + 1}`, kind: seat ? "ai" : "human", cash: count === 3 ? 28 : 15, bonds: [], investor: false, swissBank: false }));
      board.nations.forEach((nation) => { nation.government = null; nation.treasury = 0; });
      board = ensurePlay(board);
      while (board.draft) {
        expect(actorSeat(count, board.draft)).toBe(0);
        const next = chooseBond(board, 0, chooseDraftBond(board, 0));
        if ("error" in next) throw new Error(next.error);
        board = ensurePlay(next);
      }
      for (let request = 0; request < 12 && !board.finished; request += 1) {
        expect(board.turn?.hold || actingSeat(board) === 0).toBe(true);
        const command: TurnCommand = board.turn?.hold ? { action: "continue" } : chooseAICommand(board);
        const next = performTurn(board, 0, command);
        if ("error" in next) throw new Error(next.error);
        board = next;
      }
      expect(board.finished || board.turn?.hold || actingSeat(board) === 0).toBe(true);
    }
  }, 30000);
});

/** The previous production policy, expressed through the same legal-choice API. */
function oldCommand(board: Board): TurnCommand {
  const seat = actingSeat(board)!;
  const choices = describeTurn(board, seat)?.choices.map((choice) => choice.command) ?? [];
  const turn = board.turn!;
  if (turn.phase === "rondel") {
    const choicesByIndex = choices.filter((command) => command.action === "rondel");
    const tax = powerPointsForTax(nationTaxation(board, turn.nationId)) > 0 ? choicesByIndex.find((command) => command.index === 0) : undefined;
    const nation = board.nations.find((entry) => entry.id === turn.nationId)!;
    const blocked = (region: string) => board.units.some((unit) => unit.region === region && unit.nation !== nation.id && unit.kind === "army" && unit.posture === "hostile");
    const canBuild = nation.treasury >= 5 && [...regions.values()].some((region) => region.home === nation.id && !blocked(region.id) && !nation.factories.some((factory) => factory.region === region.id));
    const factory = canBuild ? choicesByIndex.find((command) => command.index === 1) : undefined;
    const canProduce = nation.factories.some((factory) => {
      const kind = factory.kind === "sea" ? "fleet" : "army";
      const cap = kind === "army" ? ARMY_CAP[nation.id] : FLEET_CAP[nation.id];
      return !blocked(factory.region) && board.units.filter((unit) => unit.nation === nation.id && unit.kind === kind).length < cap;
    });
    const production = canProduce ? choicesByIndex.find((command) => command.index === 2 || command.index === 6) : undefined;
    return tax ?? factory ?? production ?? choices[0];
  }
  if (turn.phase === "invest") {
    const price = (command: TurnCommand) => command.action === "invest" && command.interest !== null ? [0, 2, 4, 6, 9, 12, 16, 20, 25, 30][command.interest] - (command.replaceInterest === null ? 0 : [0, 2, 4, 6, 9, 12, 16, 20, 25, 30][command.replaceInterest]) : Infinity;
    return [...choices].sort((left, right) => price(left) - price(right))[0];
  }
  if (turn.phase === "import") return turn.imported === 0 ? choices.find((command) => command.action === "import" && command.kind === "army") ?? choices.at(-1)! : { action: "import-done" };
  if (turn.phase === "fleets" || turn.phase === "armies") return { action: "moves-done" };
  if (turn.phase.endsWith("battle")) return { action: "peace" };
  if (turn.phase === "destroy") return { action: "destroy", region: null };
  if (turn.phase === "veto") return { action: "veto", block: false };
  return choices[0];
}

describe("AI match regression", () => {
  it("plays legal complete games against the previous policy, with both seat assignments", () => {
    let wins = 0;
    let decisions = 0;
    let decisionMs = 0;
    for (let match = 0; match < 4; match += 1) {
      let board = table();
      const strong = match % 2;
      // Two economic starting positions, each played in both seat assignments.
      if (match >= 2) board.nations.forEach((nation) => { nation.treasury = 15; nation.score = 6; });
      const counts: Record<string, number> = {};
      const last: string[] = [];
      for (let step = 0; !board.finished && step < 1800; step += 1) {
        const seat = actingSeat(board);
        expect(seat).not.toBeNull();
        const start = performance.now();
        const command = seat === strong ? chooseAICommand(board) : oldCommand(board);
        const key = `${seat}:${command.action}${command.action === "rondel" ? command.index : ""}`;
        counts[key] = (counts[key] ?? 0) + 1;
        last.push(`${board.turn?.nationId}:${key}`);
        if (last.length > 20) last.shift();
        if (seat === strong) { decisions += 1; decisionMs += performance.now() - start; }
        const legal = describeTurn(board, seat!)?.choices.map((choice) => JSON.stringify(choice.command));
        expect(legal).toContain(JSON.stringify(command));
        board = apply(board, command);
        // Logs are audited separately; exclude their growth from search timing.
        board.log = [];
        if (board.turn) board.turn.checkpoint.log = [];
      }
      if (!board.finished) console.info("Unfinished match", { counts, last, nations: board.nations.map((nation) => ({ id: nation.id, score: nation.score, tax: nationTaxation(board, nation.id), governor: nation.government })), cash: board.players.map((player) => player.cash) });
      expect(board.finished).toBe(true);
      const scores = scoreboard(board);
      if (scores.find((score) => score.seat === strong)?.winner) wins += 1;
      console.info(`AI match ${match + 1}: strong seat ${strong}, scores ${scores.map((score) => `${score.seat}:${score.points}`).join(" ")}`);
    }
    console.info(`Strategic AI: ${wins}/4 wins; mean decision ${(decisionMs / decisions).toFixed(1)} ms (${decisions} decisions).`);
    expect(wins).toBeGreaterThanOrEqual(3);
  }, 120000);
});
