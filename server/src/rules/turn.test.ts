import { describe, expect, it } from "vitest";
import { NATION_ORDER, type NationId } from "./constants.js";
import { openingPiles } from "./draft.js";
import { describeTurn, ensurePlay, nationTaxation, performTurn, type Board, type BoardPlayer, type Unit } from "./turn.js";

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

describe("nation turns", () => {
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
    const invested = ok(performTurn(started, 0, { action: "rondel", index: 4 }));
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
    const investing = ok(performTurn(passed, 0, { action: "import-done" }));
    expect(investing.nations.find((nation) => nation.id === "ah")?.treasury).toBe(8);
    expect(investing.players[0]?.cash).toBe(22);
    expect(investing.players[0]?.swissBank).toBe(false);
    expect(investing.players[0]?.investor).toBe(true);
    expect(investing.turn?.phase).toBe("invest");
    expect(describeTurn(investing, 0)?.prompt).toContain("You hold the Investor card");
    const done = ok(performTurn(investing, 0, { action: "invest", nationId: null, interest: null, replaceInterest: null }));
    expect(done.players[1]?.investor).toBe(true);
    expect(done.turn?.phase).toBe("confirm");
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
    const invested = ok(performTurn(started, 0, { action: "rondel", index: 4 }));
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
    const invested = ok(performTurn(started, 0, { action: "rondel", index: 4 }));
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
    const investing = ok(performTurn(passed, 0, { action: "import-done" }));
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
    expect(fought.turn?.phase).not.toBe("army-battle");
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
    expect(fought.units.filter((unit) => unit.region === "LR8" && unit.nation === "uk")).toHaveLength(1);
    expect(fought.units.filter((unit) => unit.region === "LR8" && unit.nation === "fra")).toHaveLength(1);
    expect(fought.turn?.phase).not.toBe("army-battle");
    expect(describeTurn(fought, 1)?.phase).not.toBe("army-battle");
  });

  it("keeps the peace in a region without asking the other nation to fight", () => {
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
