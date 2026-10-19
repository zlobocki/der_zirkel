import { describe, expect, it } from "vitest";
import { NATION_ORDER, type NationId } from "./constants.js";
import { openingPiles } from "./draft.js";
import { actingSeat, describeTurn, ensurePlay, nationTaxation, pendingAI, performTurn, stepAI, type Board, type BoardPlayer, type Unit } from "./turn.js";

const FACTORIES: Record<NationId, Array<{ region: string; kind: "land" | "sea" }>> = {
  ah: [
    { region: "LR14", kind: "land" },
    { region: "LR16", kind: "land" },
  ],
  ita: [
    { region: "LR44", kind: "land" },
    { region: "LR45", kind: "sea" },
  ],
  fra: [
    { region: "LR3", kind: "sea" },
    { region: "LR7", kind: "land" },
  ],
  uk: [
    { region: "LR36", kind: "sea" },
    { region: "LR37", kind: "sea" },
  ],
  ger: [
    { region: "LR11", kind: "sea" },
    { region: "LR12", kind: "land" },
  ],
  rus: [
    { region: "LR21", kind: "land" },
    { region: "LR24", kind: "sea" },
  ],
};

function player(seat: number, cash: number, extra: Partial<BoardPlayer> = {}): BoardPlayer {
  return {
    seat,
    kind: "human",
    userId: `user-${seat}`,
    username: seat === 0 ? "Ada" : "Bea",
    cash,
    bonds: [],
    investor: seat === 0,
    swissBank: seat !== 0,
    ...extra,
  };
}

function game(options: {
  government?: Partial<Record<NationId, number | null>>;
  factories?: Partial<Record<NationId, Array<{ region: string; kind: "land" | "sea" }>>>;
  rondel?: Partial<Record<NationId, number | null>>;
  treasury?: Partial<Record<NationId, number>>;
  score?: Partial<Record<NationId, number>>;
  units?: Unit[];
  flags?: Board["flags"];
  players?: BoardPlayer[];
}): Board {
  const players = options.players ?? [player(0, 20), player(1, 20)];
  return ensurePlay({
    draft: null,
    turn: null,
    finished: false,
    units: options.units ?? [],
    flags: options.flags ?? [],
    nextUnit: (options.units?.length ?? 0) + 1,
    piles: openingPiles(),
    players,
    nations: NATION_ORDER.map((id) => ({
      id,
      score: options.score?.[id] ?? 0,
      tax: "tax_2-5",
      rondelIndex: options.rondel?.[id] ?? null,
      rondel: options.rondel?.[id] === undefined || options.rondel?.[id] === null ? "Rondelcenter" : `rondel_${options.rondel[id]}`,
      treasury: options.treasury?.[id] ?? 0,
      government: options.government?.[id] === undefined ? (id === "ah" ? 0 : null) : options.government[id],
      factories: options.factories?.[id] ?? FACTORIES[id],
    })),
  });
}

function ok(board: Board | { error: string }): Board {
  if ("error" in board) {
    throw new Error(board.error);
  }
  return board;
}

function confirmPayouts(board: Board): Board {
  const seat = board.nations.find((nation) => nation.id === board.turn?.nationId)?.government;
  return ok(performTurn(board, seat!, { action: "confirm-interest" }));
}

describe("entry and defensive battle rights", () => {
  function border(defenderKind: "army" | "fleet" = "army"): Board {
    const board = game({ government: { ita: 1 }, units: [
      { id: "invader", nation: "ah", kind: "army", region: "LR14", harbor: false, posture: "standing" },
      { id: "defender", nation: "ita", kind: defenderKind, region: "LR42", harbor: defenderKind === "fleet", posture: "standing" },
    ] });
    return ok(performTurn(board, 0, { action: "rondel", index: 3 }, false));
  }
  function enter(board = border(), posture: "friendly" | "hostile" = "friendly"): Board {
    return ok(performTurn(board, 0, { action: "move", unitId: "invader", region: "LR42", posture }, false));
  }

  it("pauses an AI invasion for the human defender and rejects the attacker's attempts to answer for them", () => {
    const moving = border();
    moving.players[0].kind = "ai";
    const entered = enter(moving);
    expect(entered.turn).toMatchObject({ phase: "army-battle", battleResume: "armies", attackerDone: false });
    expect(performTurn(entered, 0, { action: "moves-done" }, false)).toHaveProperty("error");
    const offered = ok(performTurn(entered, 0, { action: "peace" }, false));
    expect(actingSeat(offered)).toBe(1);
    expect(pendingAI(offered)).toBeNull();
    expect(stepAI(offered)).toBe(offered);
    expect(describeTurn(offered, 1)).toMatchObject({ yours: true, actorSeat: 1 });
    expect(describeTurn(offered, 1)?.choices.map((choice) => choice.label)).toEqual(["Fight in Venice", "Accept coexistence"]);
    expect(describeTurn(offered, 0)?.prompt).toContain("Italy must decide");
    expect(performTurn(offered, 0, { action: "peace" }, false)).toEqual({ error: "It is not your turn." });
    const fought = ok(performTurn(offered, 1, { action: "fight", ownId: "defender", enemyId: "invader" }, false));
    expect(fought.units).toHaveLength(0);
    expect(fought.turn?.phase).toBe("armies");
    expect(fought.log?.at(-1)).toMatchObject({ actorSeat: 1, battle: "land" });
  });

  it("requires both governments to accept peace, then resumes movement without asking again", () => {
    const offered = ok(performTurn(enter(), 0, { action: "peace" }, false));
    const accepted = ok(performTurn(offered, 1, { action: "peace" }, false));
    expect(accepted.units).toHaveLength(2);
    expect(accepted.turn).toMatchObject({ phase: "armies", moved: ["invader"] });
    expect(accepted.log?.at(-1)?.text).toContain("Italy accepted coexistence in Venice");
    const finished = ok(performTurn(accepted, 0, { action: "moves-done" }, false));
    const settled = ok(performTurn(finished, 0, { action: "peace" }, false));
    expect(settled.turn?.phase).not.toBe("army-battle");
  });

  it.each(["friendly", "hostile"] as const)("lets a harbor fleet fight an entering %s army", (posture) => {
    const moving = border("fleet");
    const offered = ok(performTurn(enter(moving, posture), 0, { action: "peace" }, false));
    const fought = ok(performTurn(offered, 1, { action: "fight", ownId: "defender", enemyId: "invader" }, false));
    expect(fought.units).toHaveLength(0);
  });

  it("allows defence of the protected last factory, while still forbidding hostile occupation", () => {
    const moving = border();
    moving.nations.find((nation) => nation.id === "ita")!.factories = [{ region: "LR42", kind: "sea" }];
    expect(performTurn(moving, 0, { action: "move", unitId: "invader", region: "LR42", posture: "hostile" }, false)).toHaveProperty("error");
    const offered = ok(performTurn(enter(moving), 0, { action: "peace" }, false));
    expect(actingSeat(offered)).toBe(1);
    expect(describeTurn(offered, 1)?.choices.some((choice) => choice.command.action === "fight")).toBe(true);
  });

  it("gives defenders a new response when a stationary foreign army changes posture", () => {
    const moving = border();
    moving.units[0].region = "LR42";
    moving.units[0].posture = "friendly";
    const entered = enter(moving, "hostile");
    const offered = ok(performTurn(entered, 0, { action: "peace" }, false));
    expect(actingSeat(offered)).toBe(1);
  });

  it("asks every defending country, and does not let one defender attack another", () => {
    const moving = border();
    moving.players.push(player(2, 20));
    moving.nations.find((nation) => nation.id === "fra")!.government = 2;
    moving.units.push({ id: "third", nation: "fra", kind: "army", region: "LR42", harbor: false, posture: "standing" });
    const offered = ok(performTurn(enter(moving), 0, { action: "peace" }, false));
    expect(actingSeat(offered)).toBe(1);
    expect(performTurn(offered, 1, { action: "fight", ownId: "defender", enemyId: "third" }, false)).toHaveProperty("error");
    const askedThird = ok(performTurn(offered, 1, { action: "peace" }, false));
    expect(actingSeat(askedThird)).toBe(2);
    const fought = ok(performTurn(askedThird, 2, { action: "fight", ownId: "third", enemyId: "invader" }, false));
    expect(fought.units.map((unit) => unit.id)).toEqual(["defender"]);
    expect(fought.turn?.phase).toBe("armies");
  });

  it("does not let an initial fight skip surviving defenders", () => {
    const moving = border();
    moving.units.push({ ...moving.units[0], id: "support", region: "LR42", posture: "friendly" });
    moving.units.push({ id: "third", nation: "fra", kind: "army", region: "LR42", harbor: false, posture: "standing" });
    moving.nations.find((nation) => nation.id === "fra")!.government = 1;
    const fought = ok(performTurn(enter(moving), 0, { action: "fight", ownId: "invader", enemyId: "defender" }, false));
    const offered = ok(performTurn(fought, 0, { action: "peace" }, false));
    expect(offered.turn?.battleNations).toEqual(["fra"]);
    expect(actingSeat(offered)).toBe(1);
  });

  it("requires defensive agreement at sea and returns to fleet movement", () => {
    const board = game({ government: { uk: 1 }, units: [
      { id: "a", nation: "ah", kind: "fleet", region: "SR7", harbor: false, posture: "standing" },
      { id: "b", nation: "uk", kind: "fleet", region: "SR6", harbor: false, posture: "standing" },
    ] });
    const moving = ok(performTurn(board, 0, { action: "rondel", index: 3 }, false));
    const entered = ok(performTurn(moving, 0, { action: "move", unitId: "a", region: "SR6" }, false));
    const offered = ok(performTurn(entered, 0, { action: "peace" }, false));
    expect(actingSeat(offered)).toBe(1);
    const fought = ok(performTurn(offered, 1, { action: "fight", ownId: "b", enemyId: "a" }, false));
    expect(fought.units).toHaveLength(0);
    expect(fought.turn?.phase).toBe("fleets");
    expect(fought.log?.at(-1)?.battle).toBe("sea");
  });

  it("permits friendly entry without a border veto when the province has no defending units", () => {
    const moving = border();
    moving.units = moving.units.filter((unit) => unit.id !== "defender");
    const entered = enter(moving);
    expect(entered.turn?.phase).toBe("armies");
    expect(entered.units[0]).toMatchObject({ region: "LR42", posture: "friendly" });
  });

  it("restores defender responses in a battle saved by the previous version", () => {
    const entered = enter();
    delete entered.turn!.battleResume;
    entered.turn!.battleNations = [];
    const offered = ok(performTurn(entered, 0, { action: "peace" }, false));
    expect(actingSeat(offered)).toBe(1);
  });
});

describe("nation turns", () => {
  it("previews everyone's interest and bonus before any payout, then pays exactly once", () => {
    const started = game({ treasury: { ah: 10 }, players: [
      player(0, 10, { bonds: [{ nation: "ah", interest: 2, price: 4 }] }),
      player(1, 20, { bonds: [{ nation: "ah", interest: 4, price: 9 }] }),
    ] });
    const review = ok(performTurn(started, 0, { action: "rondel", index: 4 }));
    expect(review.turn?.phase).toBe("interest");
    expect(review.players.map((entry) => entry.cash)).toEqual([10, 20]);
    expect(review.nations[0].treasury).toBe(10);
    const expected = { treasuryPayment: 6, governmentPayment: 0, passedInvestor: false, players: [
      { seat: 0, interest: 2, bonus: 2, contribution: 0, net: 4 },
      { seat: 1, interest: 4, bonus: 0, contribution: 0, net: 4 },
    ] };
    expect(describeTurn(review, 0)?.payouts).toEqual(expected);
    expect(describeTurn(review, 1)?.payouts).toEqual(expected);
    expect(describeTurn(review, 1)?.choices).toEqual([]);
    expect(performTurn(review, 1, { action: "confirm-interest" })).toHaveProperty("error");
    expect(performTurn(review, 0, { action: "invest", nationId: "ger", interest: 1, replaceInterest: null })).toHaveProperty("error");
    const paid = confirmPayouts(review);
    expect(paid.players.map((entry) => entry.cash)).toEqual([14, 24]);
    expect(paid.nations[0].treasury).toBe(4);
    expect(paid.turn?.phase).toBe("invest");
    expect(performTurn(paid, 0, { action: "confirm-interest" })).toHaveProperty("error");
  });

  it("shows personal contributions and forfeited interest when the treasury is short", () => {
    const started = game({ treasury: { ah: 1 }, players: [
      player(0, 10, { bonds: [{ nation: "ah", interest: 2, price: 4 }] }),
      player(1, 20, { bonds: [{ nation: "ah", interest: 4, price: 9 }] }),
    ] });
    const review = ok(performTurn(started, 0, { action: "rondel", index: 4 }));
    const preview = describeTurn(review, 0)?.payouts;
    expect(preview).toMatchObject({ treasuryPayment: 1, governmentPayment: 3 });
    expect(preview?.players[0]).toEqual({ seat: 0, interest: 0, bonus: 2, contribution: 3, net: -1 });
    const paid = confirmPayouts(review);
    expect(paid.players[0].cash - review.players[0].cash).toBe(preview?.players[0].net);
    expect(paid.players[1].cash - review.players[1].cash).toBe(preview?.players[1].net);
    expect(paid.log?.at(-1)?.text).toContain("Ada contributed 3 million personally");
    expect(paid.log?.at(-1)?.text).not.toContain("paid Ada 2 million interest");
  });

  it("reviews only the Investor bonus when the Investor space was passed", () => {
    const started = game({ rondel: { ah: 3 }, treasury: { ah: 8 }, players: [
      player(0, 20, { bonds: [{ nation: "ah", interest: 2, price: 4 }], swissBank: false }),
      player(1, 20, { swissBank: false }),
    ] });
    const importing = ok(performTurn(started, 0, { action: "rondel", index: 5 }));
    const review = ok(performTurn(importing, 0, { action: "import-done" }));
    expect(review.players[0].cash).toBe(20);
    expect(describeTurn(review, 0)?.payouts).toMatchObject({ passedInvestor: true, treasuryPayment: 0, governmentPayment: 0 });
    expect(describeTurn(review, 0)?.payouts?.players[0]).toEqual({ seat: 0, interest: 0, bonus: 2, contribution: 0, net: 2 });
    expect(confirmPayouts(review).players[0].cash).toBe(22);
  });
  function transportGame(seas: string[], count = 2, origin = "LR40") {
    return game({ government: { ah: null, uk: 0 }, units: [
      ...Array.from({ length: count }, (_, index): Unit => ({ id: `army-${index}`, nation: "uk", kind: "army", region: origin, harbor: false, posture: "standing" })),
      ...seas.map((region, index): Unit => ({ id: `fleet-${index}`, nation: "uk", kind: "fleet", region, harbor: false, posture: "standing" })),
    ] });
  }

  function enterArmyMoves(board: Board) {
    const fleets = ok(performTurn(board, 0, { action: "rondel", index: 3 }));
    return ok(performTurn(fleets, 0, { action: "moves-done" }));
  }

  it("reserves one fleet in every traversed sea for each transported army", () => {
    const moving = enterArmyMoves(transportGame(["SR7", "SR1"]));
    const first = ok(performTurn(moving, 0, { action: "move", unitId: "army-0", region: "LR35" }));
    expect(first.turn?.transported).toEqual(["fleet-0", "fleet-1"]);
    const saved = JSON.parse(JSON.stringify(first)) as Board;
    expect(performTurn(saved, 0, { action: "move", unitId: "army-1", region: "LR35" })).toMatchObject({ error: "That army cannot move there." });
    expect(describeTurn(saved, 0)?.choices.some(({ command }) => command.action === "move" && command.unitId === "army-1" && command.region === "LR35")).toBe(false);
    expect(moving.turn?.transported).toEqual([]);
  });

  it("allows two armies across two seas only with two fleets in each sea", () => {
    let moving = enterArmyMoves(transportGame(["SR7", "SR7", "SR1", "SR1"], 3));
    for (const unitId of ["army-0", "army-1"]) moving = ok(performTurn(moving, 0, { action: "move", unitId, region: "LR35" }));
    expect(new Set(moving.turn?.transported).size).toBe(4);
    expect(performTurn(moving, 0, { action: "move", unitId: "army-2", region: "LR35" })).toHaveProperty("error");
  });

  it("enforces the bottleneck while leaving unused fleets available for shorter trips", () => {
    const moving = enterArmyMoves(transportGame(["SR7", "SR7", "SR1"]));
    const first = ok(performTurn(moving, 0, { action: "move", unitId: "army-0", region: "LR35" }));
    expect(performTurn(first, 0, { action: "move", unitId: "army-1", region: "LR35" })).toHaveProperty("error");
    const second = ok(performTurn(first, 0, { action: "move", unitId: "army-1", region: "LR39" }));
    expect(second.turn?.transported).toHaveLength(3);
  });

  it("does not spend fleet capacity when a land or rail route is available", () => {
    const moving = enterArmyMoves(transportGame(["SR7"], 2, "LR36"));
    const overland = ok(performTurn(moving, 0, { action: "move", unitId: "army-0", region: "LR39" }));
    expect(overland.turn?.transported).toEqual([]);
    const sailed = ok(performTurn(overland, 0, { action: "move", unitId: "army-1", region: "LR40" }));
    expect(sailed.turn?.transported).toEqual(["fleet-0"]);
  });

  it("restores transport capacity on undo and on a new maneuver turn", () => {
    const original = transportGame(["SR7", "SR1"]);
    const first = ok(performTurn(enterArmyMoves(original), 0, { action: "move", unitId: "army-0", region: "LR35" }));
    const undone = ok(performTurn(first, 0, { action: "undo" }));
    expect(undone.turn?.transported).toEqual([]);
    expect(ok(performTurn(enterArmyMoves(undone), 0, { action: "move", unitId: "army-0", region: "LR35" })).turn?.transported).toHaveLength(2);
    const finished = ok(performTurn(first, 0, { action: "moves-done" }));
    const next = ok(performTurn(finished, 0, { action: "confirm" }));
    expect(next.turn?.transported).toEqual([]);
    const proposed = ok(performTurn(next, 0, { action: "rondel", index: 7 }));
    const fleets = ok(performTurn(proposed, 1, { action: "veto", block: false }));
    const armies = ok(performTurn(fleets, 0, { action: "moves-done" }));
    expect(ok(performTurn(armies, 0, { action: "move", unitId: "army-0", region: "LR40" })).turn?.transported).toHaveLength(2);
  });

  it("uses a fleet's capacity after it has moved to a sea during the fleet phase", () => {
    const started = transportGame(["SR6"]);
    const fleets = ok(performTurn(started, 0, { action: "rondel", index: 3 }));
    const sailed = ok(performTurn(fleets, 0, { action: "move", unitId: "fleet-0", region: "SR7" }));
    const armies = ok(performTurn(sailed, 0, { action: "moves-done" }));
    expect(ok(performTurn(armies, 0, { action: "move", unitId: "army-0", region: "LR39" })).turn?.transported).toEqual(["fleet-0"]);
  });

  it("does not use opposing fleets or harbor fleets for transport", () => {
    for (const fleet of [
      { nation: "fra" as const, region: "SR7", harbor: false },
      { nation: "uk" as const, region: "LR37", harbor: true },
    ]) {
      const started = transportGame(["SR7", "SR1"]);
      Object.assign(started.units.find((unit) => unit.id === "fleet-0")!, fleet);
      const fleets = ok(performTurn(started, 0, { action: "rondel", index: 3 }));
      const armies = ok(performTurn(fleets, 0, { action: "moves-done" }));
      expect(performTurn(armies, 0, { action: "move", unitId: "army-0", region: "LR35" })).toHaveProperty("error");
    }
  });

  it("collects tax from unoccupied factories and can undo the whole turn", () => {
    const started = game({});
    const taxed = ok(performTurn(started, 0, { action: "rondel", index: 0 }));
    const austria = taxed.nations.find((nation) => nation.id === "ah");
    expect(austria).toMatchObject({ treasury: 4, score: 0, tax: "tax_2-5", rondel: "rondel_0" });
    expect(taxed.turn?.phase).toBe("confirm");
    expect(describeTurn(taxed, 0)?.prompt).toBe("Austria-Hungary's turn is finished.");

    const undone = ok(performTurn(taxed, 0, { action: "undo" }));
    expect(undone.nations.find((nation) => nation.id === "ah")).toMatchObject({ treasury: 0, rondel: "Rondelcenter" });
    expect(undone.turn?.phase).toBe("rondel");
  });

  it("charges the government for a rondel move past the third space", () => {
    const started = game({ rondel: { ah: 4 }, treasury: { ah: 5 } });
    const moved = ok(performTurn(started, 0, { action: "rondel", index: 1 }));
    expect(moved.players[0]?.cash).toBe(16);
    expect(moved.turn?.phase).toBe("factory");
  });

  it("offers Austria-Hungary's empty home cities on the first factory action", () => {
    const short = game({ treasury: { ah: 2 } });
    const waiting = ok(performTurn(short, 0, { action: "rondel", index: 1 }));
    expect(waiting.turn?.phase).toBe("factory");
    expect(describeTurn(waiting, 0)?.prompt).toBe("Austria-Hungary needs 5 million in the treasury before a factory can be built.");
    expect(describeTurn(waiting, 0)?.choices.map((choice) => choice.label)).toEqual(["Build nothing"]);

    const started = game({ treasury: { ah: 6 } });
    const building = ok(performTurn(started, 0, { action: "rondel", index: 1 }));
    const labels = describeTurn(building, 0)?.choices.map((choice) => choice.label) ?? [];
    expect(labels).toContain("Factory in Prague");
    expect(labels).toContain("Factory in Lemberg");
    expect(labels).toContain("Shipyard in Trieste");
    expect(labels).toContain("Build nothing");
    expect(labels.join(" ")).not.toContain("Vienna");
    expect(labels.join(" ")).not.toContain("Budapest");
    const built = ok(performTurn(building, 0, { action: "factory", region: "LR15" }));
    expect(built.nations.find((nation) => nation.id === "ah")?.treasury).toBe(1);
    expect(built.nations.find((nation) => nation.id === "ah")?.factories.map((factory) => factory.region)).toEqual(
      expect.arrayContaining(["LR14", "LR16", "LR15"]),
    );
  });

  it("lets Germany build in an unblocked home city", () => {
    const hostile: Unit = { id: "u1", nation: "fra", kind: "army", region: "LR10", harbor: false, posture: "hostile" };
    const started = game({
      government: { ah: null, ger: 0 },
      factories: { ger: [{ region: "LR12", kind: "land" }, { region: "LR11", kind: "sea" }] },
      treasury: { ger: 10 },
      units: [hostile],
    });
    const building = ok(performTurn(started, 0, { action: "rondel", index: 1 }));
    const labels = describeTurn(building, 0)?.choices.map((choice) => choice.label) ?? [];
    expect(labels).toContain("Factory in Munich");
    expect(labels).toContain("Shipyard in Danzig");
    expect(labels.join(" ")).not.toContain("Cologne");
    const built = ok(performTurn(building, 0, { action: "factory", region: "LR13" }));
    expect(built.nations.find((nation) => nation.id === "ger")).toMatchObject({ treasury: 5 });
    expect(built.nations.find((nation) => nation.id === "ger")?.factories.map((factory) => factory.region)).toContain("LR13");
  });

  it("produces only in factories without a hostile army", () => {
    const started = game({
      government: { ah: null, ger: 0 },
      factories: {
        ger: [
          { region: "LR12", kind: "land" },
          { region: "LR11", kind: "sea" },
          { region: "LR13", kind: "land" },
        ],
      },
      units: [{ id: "u1", nation: "rus", kind: "army", region: "LR12", harbor: false, posture: "hostile" }],
    });
    const produced = ok(performTurn(started, 0, { action: "rondel", index: 2 }));
    expect(produced.units.map((unit) => `${unit.kind}:${unit.region}:${unit.harbor}`).sort()).toEqual([
      "army:LR12:false",
      "army:LR13:false",
      "fleet:LR11:true",
    ]);
  });

  it("imports at most three units and keeps fleets in seaports", () => {
    const started = game({ treasury: { ah: 5 } });
    let current = ok(performTurn(started, 0, { action: "rondel", index: 5 }));
    expect(performTurn(current, 0, { action: "import", kind: "fleet", region: "LR14" })).toMatchObject({
      error: "That unit cannot be placed there.",
    });
    for (const region of ["LR14", "LR16", "LR18"]) {
      const kind = region === "LR18" ? "fleet" : "army";
      current = ok(performTurn(current, 0, { action: "import", kind, region }));
    }
    expect(current.turn?.phase).toBe("confirm");
    expect(current.nations.find((nation) => nation.id === "ah")?.treasury).toBe(2);
    expect(current.units.filter((unit) => unit.nation === "ah")).toHaveLength(3);
  });

  it("makes the government cover interest the treasury cannot pay", () => {
    const started = game({
      treasury: { ah: 1 },
      players: [
        player(0, 10, { bonds: [{ nation: "ah", interest: 2, price: 4 }], investor: true, swissBank: false }),
        player(1, 20, { bonds: [{ nation: "ah", interest: 4, price: 9 }], investor: false, swissBank: true }),
      ],
    });
    const invested = confirmPayouts(ok(performTurn(started, 0, { action: "rondel", index: 4 })));
    expect(invested.players[0]?.cash).toBe(9);
    expect(invested.players[1]?.cash).toBe(24);
    expect(invested.nations.find((nation) => nation.id === "ah")?.treasury).toBe(0);
    expect(invested.turn?.phase).toBe("invest");
  });

  it("refuses Investor when the government cannot cover the interest", () => {
    const started = game({
      treasury: { ah: 0 },
      players: [
        player(0, 1, { bonds: [], investor: true, swissBank: false }),
        player(1, 20, { bonds: [{ nation: "ah", interest: 4, price: 9 }], investor: false, swissBank: false }),
      ],
    });
    expect(performTurn(started, 0, { action: "rondel", index: 4 })).toMatchObject({
      error: "The treasury cannot pay the interest.",
    });
    expect(started.players[0]?.cash).toBe(1);
  });

  it("runs the investor purchase when Investor is only passed", () => {
    const started = game({
      rondel: { ah: 3 },
      treasury: { ah: 8 },
      players: [player(0, 20, { investor: true, swissBank: false }), player(1, 20, { investor: false, swissBank: false })],
    });
    const passed = ok(performTurn(started, 0, { action: "rondel", index: 5 }));
    expect(passed.turn?.phase).toBe("import");
    const investing = confirmPayouts(ok(performTurn(passed, 0, { action: "import-done" })));
    expect(investing.nations.find((nation) => nation.id === "ah")?.treasury).toBe(8);
    expect(investing.players[0]?.cash).toBe(22);
    expect(investing.players[0]?.swissBank).toBe(false);
    expect(investing.players[0]?.investor).toBe(true);
    expect(investing.turn?.phase).toBe("invest");
    expect(describeTurn(investing, 0)?.prompt).toContain("You hold the Investor card");
    const done = ok(performTurn(investing, 0, { action: "invest", nationId: null, interest: null, replaceInterest: null }));
    expect(done.players[1]?.investor).toBe(true);
    // No bonds are held in this fixture, so no country has a government left.
    expect(done.turn).toBeNull();
  });

  it("advances directly to the next country after the last bond buyer", () => {
    const started = game({ government: { ah: 0, ita: 1 }, treasury: { ah: 10 }, players: [
      player(0, 20, { bonds: [{ nation: "ah", interest: 1, price: 2 }], swissBank: false }),
      player(1, 20, { bonds: [{ nation: "ita", interest: 1, price: 2 }], swissBank: true }),
    ] });
    const investing = confirmPayouts(ok(performTurn(started, 0, { action: "rondel", index: 4 })));
    const first = ok(performTurn(investing, 0, { action: "invest", nationId: "ger", interest: 1, replaceInterest: null }));
    expect(first.turn?.phase).toBe("invest");
    expect(first.turn?.investors).toEqual([1]);
    const done = ok(performTurn(first, 1, { action: "invest", nationId: "fra", interest: 2, replaceInterest: null }));
    expect(done.turn).toMatchObject({ nationId: "ita", phase: "rondel" });
    expect(describeTurn(done, 1)).toMatchObject({ yours: true, canConfirm: false });
    expect(done.players[1]?.investor).toBe(true);
    expect(done.log?.at(-1)?.text).toContain("Bea bought a France bond");
  });

  it("advances after the final investor passes, including an AI buyer", () => {
    const started = game({ government: { ah: 0, ita: 0 }, treasury: { ah: 10 }, players: [
      player(0, 20, { bonds: [{ nation: "ah", interest: 2, price: 4 }, { nation: "ita", interest: 2, price: 4 }], swissBank: false }),
      player(1, 0, { kind: "ai", investor: false, swissBank: true }),
    ] });
    const investing = confirmPayouts(ok(performTurn(started, 0, { action: "rondel", index: 4 })));
    const done = ok(performTurn(investing, 0, { action: "invest", nationId: null, interest: null, replaceInterest: null }));
    expect(done.turn).toMatchObject({ nationId: "ita", phase: "rondel" });
    expect(done.log?.at(-1)?.text).toContain("Bea passed on buying a bond");
  });

  it("keeps an ordered public action log across undo and rejects invalid actions without logging", () => {
    const started = game({});
    const taxed = ok(performTurn(started, 0, { action: "rondel", index: 0 }));
    expect(taxed.log?.at(-1)?.text).toContain("Ada chose Taxation for Austria-Hungary");
    expect(taxed.log?.at(-1)?.text).toContain("treasury: 0 → 4 million");
    expect(started.log).toBeUndefined();
    const undone = ok(performTurn(taxed, 0, { action: "undo" }));
    expect(undone.log?.map((entry) => entry.id)).toEqual([1, 2]);
    expect(undone.log?.at(-1)?.text).toContain("Ada undid Austria-Hungary's turn");
    const snapshot = JSON.stringify(undone.log);
    expect(performTurn(undone, 1, { action: "rondel", index: 0 })).toHaveProperty("error");
    expect(JSON.stringify(undone.log)).toBe(snapshot);
    expect(snapshot).not.toContain("cash");
  });

  it("ends the game on 25 power and skips the investor purchase", () => {
    const started = game({
      score: { ah: 24 },
      rondel: { ah: 3 },
      flags: [
        { region: "LR1", nation: "ah" },
        { region: "LR2", nation: "ah" },
      ],
      players: [player(0, 20, { investor: false, swissBank: false }), player(1, 15, { investor: true, swissBank: false })],
    });
    const ended = ok(performTurn(started, 0, { action: "rondel", index: 0 }));
    expect(ended.finished).toBe(true);
    expect(ended.nations.find((nation) => nation.id === "ah")?.score).toBeGreaterThanOrEqual(25);
    expect(ended.players[1]?.cash).toBe(15);
    expect(ended.turn).toBeNull();
  });

  it("sends a harbor fleet only to its sea, then keeps it at sea", () => {
    const started = game({
      government: { ah: null, uk: 0 },
      units: [{ id: "u1", nation: "uk", kind: "fleet", region: "LR36", harbor: true, posture: "standing" }],
    });
    const moving = ok(performTurn(started, 0, { action: "rondel", index: 3 }));
    const sailed = ok(performTurn(moving, 0, { action: "move", unitId: "u1", region: "SR6" }));
    expect(sailed.units[0]).toMatchObject({ region: "SR6", harbor: false });
    expect(performTurn(sailed, 0, { action: "move", unitId: "u1", region: "LR36" })).toMatchObject({
      error: "That unit has already moved.",
    });
  });

  it("lets an army use the railroad before crossing a border", () => {
    const started = game({
      government: { ah: null, ger: 0 },
      units: [{ id: "u1", nation: "ger", kind: "army", region: "LR10", harbor: false, posture: "standing" }],
    });
    const moving = ok(performTurn(started, 0, { action: "rondel", index: 3 }));
    const arrived = ok(performTurn(moving, 0, { action: "move", unitId: "u1", region: "LR25" }));
    expect(arrived.units[0]?.region).toBe("LR25");
    const finished = ok(performTurn(arrived, 0, { action: "moves-done" }));
    expect(finished.flags).toContainEqual({ region: "LR25", nation: "ger" });
  });

  it("will not let a hostile army enter the last unoccupied factory", () => {
    const started = game({
      factories: { ita: [{ region: "LR44", kind: "land" }] },
      units: [{ id: "u1", nation: "ah", kind: "army", region: "LR42", harbor: false, posture: "standing" }],
    });
    const moving = ok(performTurn(started, 0, { action: "rondel", index: 3 }));
    expect(performTurn(moving, 0, { action: "move", unitId: "u1", region: "LR44", posture: "hostile" })).toMatchObject({
      error: "That factory is the nation's last and cannot be invaded.",
    });
    const friendly = ok(performTurn(moving, 0, { action: "move", unitId: "u1", region: "LR44", posture: "friendly" }));
    expect(friendly.units[0]?.posture).toBe("friendly");
  });

  it("destroys a factory with three hostile armies", () => {
    const armies: Unit[] = [1, 2, 3].map((id) => ({
      id: `u${id}`,
      nation: "ah" as const,
      kind: "army" as const,
      region: "LR44",
      harbor: false,
      posture: "hostile" as const,
    }));
    const started = game({ units: armies });
    const moving = ok(performTurn(started, 0, { action: "rondel", index: 3 }));
    const done = ok(performTurn(moving, 0, { action: "moves-done" }));
    expect(done.turn?.phase).toBe("destroy");
    const ruined = ok(performTurn(done, 0, { action: "destroy", region: "LR44" }));
    expect(ruined.nations.find((nation) => nation.id === "ita")?.factories.map((factory) => factory.region)).toEqual(["LR45"]);
    expect(ruined.units.filter((unit) => unit.nation === "ah")).toHaveLength(0);
  });

  it("offers bonds the investor can afford after interest and the two million bonus", () => {
    const started = game({
      players: [player(0, 10, { investor: true, swissBank: false }), player(1, 0, { investor: false, swissBank: false })],
    });
    const invested = confirmPayouts(ok(performTurn(started, 0, { action: "rondel", index: 4 })));
    expect(invested.players[0]?.cash).toBe(12);
    const interests = (describeTurn(invested, 0)?.choices ?? []).flatMap((entry) => {
      const command = entry.command;
      if (command.action !== "invest" || command.nationId !== "ah" || command.replaceInterest !== null) {
        return [];
      }
      return [command.interest];
    });
    expect(interests).toContain(5);
    expect(interests).not.toContain(6);
  });

  it("sells another bond at full price and can also raise the one already held", () => {
    const started = game({
      players: [
        player(0, 20, { bonds: [{ nation: "ah", interest: 2, price: 4 }], investor: true, swissBank: false }),
        player(1, 0, { investor: false, swissBank: false }),
      ],
    });
    started.piles.ah = started.piles.ah.filter((interest) => interest !== 2);
    const invested = confirmPayouts(ok(performTurn(started, 0, { action: "rondel", index: 4 })));
    expect(invested.players[0]?.cash).toBe(22);
    const choices = describeTurn(invested, 0)?.choices ?? [];
    const interests = (replaceInterest: number | null) =>
      choices.flatMap((entry) => {
        const command = entry.command;
        if (command.action !== "invest" || command.nationId !== "ah" || command.replaceInterest !== replaceInterest) {
          return [];
        }
        return [command.interest];
      });
    const buys = interests(null);
    const raises = interests(2);
    expect(buys).toContain(1);
    expect(buys).toContain(5);
    expect(buys).not.toContain(8);
    expect(raises).toContain(5);
    expect(raises).toContain(8);
    expect(raises).not.toContain(9);
    const bought = ok(performTurn(invested, 0, { action: "invest", nationId: "ah", interest: 1, replaceInterest: null }));
    expect(bought.players[0]?.cash).toBe(20);
    expect(bought.players[0]?.bonds).toEqual(
      expect.arrayContaining([
        { nation: "ah", interest: 2, price: 4 },
        { nation: "ah", interest: 1, price: 2 },
      ]),
    );
    const raised = ok(performTurn(invested, 0, { action: "invest", nationId: "ah", interest: 5, replaceInterest: 2 }));
    expect(raised.players[0]?.cash).toBe(14);
    expect(raised.players[0]?.bonds).toEqual([{ nation: "ah", interest: 5, price: 12 }]);
    expect(raised.piles.ah).toContain(2);
    expect(raised.piles.ah).not.toContain(5);
  });

  it("lets the player upgrade either bond they hold in a nation", () => {
    const started = game({
      treasury: { ah: 20 },
      players: [
        player(0, 10, {
          bonds: [
            { nation: "ah", interest: 1, price: 2 },
            { nation: "ah", interest: 2, price: 4 },
          ],
          investor: true,
          swissBank: false,
        }),
      ],
    });
    started.piles.ah = started.piles.ah.filter((interest) => interest !== 1 && interest !== 2);
    const invested = confirmPayouts(ok(performTurn(started, 0, { action: "rondel", index: 4 })));
    const raises = (describeTurn(invested, 0)?.choices ?? []).flatMap((entry) => {
      const command = entry.command;
      if (command.action !== "invest" || command.nationId !== "ah" || command.interest !== 3) {
        return [];
      }
      return [command.replaceInterest];
    });
    expect(raises).toEqual(expect.arrayContaining([1, 2]));
    const raised = ok(performTurn(invested, 0, { action: "invest", nationId: "ah", interest: 3, replaceInterest: 1 }));
    expect(raised.players[0]?.bonds).toEqual(
      expect.arrayContaining([
        { nation: "ah", interest: 2, price: 4 },
        { nation: "ah", interest: 3, price: 6 },
      ]),
    );
    expect(raised.players[0]?.bonds).toHaveLength(2);
    expect(raised.piles.ah).toContain(1);
  });

  it("lets the Swiss bank stop a move that passes Investor", () => {
    const started = game({ rondel: { ah: 3 } });
    const asked = ok(performTurn(started, 0, { action: "rondel", index: 5 }));
    expect(asked.turn?.phase).toBe("veto");
    expect(describeTurn(asked, 1)?.yours).toBe(true);
    const blocked = ok(performTurn(asked, 1, { action: "veto", block: true }));
    expect(blocked.turn?.phase).toBe("rondel");
    expect(blocked.nations.find((nation) => nation.id === "ah")?.rondel).toBe("rondel_3");
    expect(blocked.players[0]?.cash).toBe(20);
  });

  it("still offers the investor card holder a bond in a solo game after Investor is passed", () => {
    const started = game({
      rondel: { ah: 3 },
      treasury: { ah: 8 },
      players: [player(0, 20, { investor: true, swissBank: false })],
    });
    const passed = ok(performTurn(started, 0, { action: "rondel", index: 5 }));
    expect(passed.turn?.phase).toBe("import");
    const investing = confirmPayouts(ok(performTurn(passed, 0, { action: "import-done" })));
    expect(investing.players[0]).toMatchObject({ swissBank: false, investor: true, cash: 22 });
    expect(investing.turn?.phase).toBe("invest");
    expect(describeTurn(investing, 0)?.prompt).toContain("You hold the Investor card");
  });

  it("offers one fight button for a region when several friendly units face one army", () => {
    const started = game({
      government: { uk: 0, fra: 1 },
      units: [
        { id: "uk1", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "uk2", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "fr1", nation: "fra", kind: "army", region: "LR8", harbor: false, posture: "standing" },
      ],
    });
    const checkpoint = structuredClone(started);
    checkpoint.turn = null;
    started.turn = {
      nationId: "uk",
      phase: "army-battle",
      passedInvestor: false,
      checkpoint,
      moved: [],
      imported: 0,
      battleRegions: ["LR8"],
      battleNations: [],
      attackerDone: false,
      investors: [],
      vetoSeats: [],
      pendingIndex: null,
      hold: false,
    };
    const fights = describeTurn(started, 0)?.choices.filter((choice) => choice.command.action === "fight") ?? [];
    expect(fights.map((choice) => choice.label)).toEqual(["Fight in Belgium"]);
    const command = fights[0]?.command;
    if (!command || command.action !== "fight") {
      throw new Error("missing fight");
    }
    const fought = ok(performTurn(started, 0, command));
    expect(fought.units.filter((unit) => unit.region === "LR8" && unit.nation === "uk")).toHaveLength(1);
    expect(fought.units.filter((unit) => unit.nation === "fra")).toHaveLength(0);
    expect(fought.turn?.phase).not.toBe("army-battle");
    expect(fought.log?.at(-1)?.battle).toBe("land");
  });

  it("marks a fleet battle for sea audio in the public action log", () => {
    const started = game({ government: { ah: null, uk: 0, fra: 1 }, units: [
      { id: "uk1", nation: "uk", kind: "fleet", region: "SR6", harbor: false, posture: "standing" },
      { id: "fr1", nation: "fra", kind: "fleet", region: "SR6", harbor: false, posture: "standing" },
    ] });
    if (!started.turn) throw new Error("Missing turn");
    started.turn.nationId = "uk";
    started.turn.phase = "fleet-battle";
    started.turn.battleRegions = ["SR6"];
    const fought = ok(performTurn(started, 0, { action: "fight", ownId: "uk1", enemyId: "fr1" }));
    expect(fought.log?.at(-1)?.battle).toBe("sea");
    expect(fought.units).toHaveLength(0);
    expect(started.log).toBeUndefined();
  });

  it("offers one fight button for each opposing nation in a region", () => {
    const started = game({
      government: { uk: 0, fra: 1, ger: 1 },
      units: [
        { id: "uk1", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "uk2", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "fr1", nation: "fra", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "ge1", nation: "ger", kind: "army", region: "LR8", harbor: false, posture: "standing" },
      ],
    });
    const checkpoint = structuredClone(started);
    checkpoint.turn = null;
    started.turn = {
      nationId: "uk",
      phase: "army-battle",
      passedInvestor: false,
      checkpoint,
      moved: [],
      imported: 0,
      battleRegions: ["LR8"],
      battleNations: [],
      attackerDone: false,
      investors: [],
      vetoSeats: [],
      pendingIndex: null,
      hold: false,
    };
    const fights = describeTurn(started, 0)?.choices.filter((choice) => choice.command.action === "fight") ?? [];
    expect(fights.map((choice) => choice.label)).toEqual(["Fight the France army", "Fight the Germany army"]);
    const command = fights[0]?.command;
    if (!command || command.action !== "fight") {
      throw new Error("missing fight");
    }
    const fought = ok(performTurn(started, 0, command));
    expect(fought.units.filter((unit) => unit.region === "LR8" && unit.nation === "ger")).toHaveLength(1);
    expect(fought.turn?.phase).toBe("army-battle");
    expect(describeTurn(fought, 0)?.choices.filter((choice) => choice.command.action === "fight")).toHaveLength(1);
    const settled = ok(performTurn(fought, 0, { action: "fight", ownId: "uk2", enemyId: "ge1" }));
    expect(settled.turn?.phase).not.toBe("army-battle");
  });

  it("lets one fight settle a region while both sides still have armies", () => {
    const started = game({
      government: { uk: 0, fra: 1 },
      units: [
        { id: "uk1", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "uk2", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "fr1", nation: "fra", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "fr2", nation: "fra", kind: "army", region: "LR8", harbor: false, posture: "standing" },
      ],
    });
    const checkpoint = structuredClone(started);
    checkpoint.turn = null;
    started.turn = {
      nationId: "uk",
      phase: "army-battle",
      passedInvestor: false,
      checkpoint,
      moved: [],
      imported: 0,
      battleRegions: ["LR8"],
      battleNations: [],
      attackerDone: false,
      investors: [],
      vetoSeats: [],
      pendingIndex: null,
      hold: false,
    };
    const view = describeTurn(started, 0);
    const fights = view?.choices.filter((choice) => choice.command.action === "fight") ?? [];
    expect(fights.map((choice) => choice.label)).toEqual(["Fight in Belgium"]);
    const command = fights[0]?.command;
    if (!command || command.action !== "fight") {
      throw new Error("missing fight");
    }
    const fought = ok(performTurn(started, 0, command));
    expect(fought.units.filter((unit) => unit.region === "LR8")).toHaveLength(0);
    expect(fought.turn?.phase).not.toBe("army-battle");
    expect(describeTurn(fought, 1)?.phase).not.toBe("army-battle");
  });

  it("does not let inactive troops initiate combat when no army entered or changed posture", () => {
    const started = game({
      government: { uk: 0, fra: 1 },
      units: [
        { id: "uk1", nation: "uk", kind: "army", region: "LR8", harbor: false, posture: "standing" },
        { id: "fr1", nation: "fra", kind: "army", region: "LR8", harbor: false, posture: "standing" },
      ],
    });
    const checkpoint = structuredClone(started);
    checkpoint.turn = null;
    started.turn = {
      nationId: "uk",
      phase: "army-battle",
      passedInvestor: false,
      checkpoint,
      moved: [],
      imported: 0,
      battleRegions: ["LR8"],
      battleNations: [],
      attackerDone: false,
      investors: [],
      vetoSeats: [],
      pendingIndex: null,
      hold: false,
    };
    const peaceful = ok(performTurn(started, 0, { action: "peace" }));
    expect(peaceful.units).toHaveLength(2);
    expect(peaceful.turn?.phase).not.toBe("army-battle");
  });

  it("drops a factory from taxation while a hostile army occupies it", () => {
    const hostile = game({
      government: { ah: null, ger: 0 },
      units: [{ id: "u1", nation: "rus", kind: "army", region: "LR12", harbor: false, posture: "hostile" }],
    });
    expect(nationTaxation(hostile, "ger")).toBe(2);
    const friendly = game({
      government: { ah: null, ger: 0 },
      units: [{ id: "u1", nation: "rus", kind: "army", region: "LR12", harbor: false, posture: "friendly" }],
    });
    expect(nationTaxation(friendly, "ger")).toBe(4);
    const produced = ok(performTurn(friendly, 0, { action: "rondel", index: 2 }));
    expect(produced.units.filter((unit) => unit.nation === "ger" && unit.region === "LR12")).toHaveLength(1);
  });
});
