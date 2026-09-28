import { describe, expect, it } from "vitest";
import { powerPointsForTax, rondelCost, scoreFactor, taxTrack } from "./constants.js";
import { actorSeat, chooseBond, closeDraft, openingPiles, playAutomaticDraft, type DraftPosition } from "./draft.js";
import { linked, regions } from "./map.js";

function position(cash: number[]): DraftPosition {
  return {
    draft: { nationIndex: 0, offerIndex: 0 },
    piles: openingPiles(),
    nations: (["ah", "ita", "fra", "uk", "ger", "rus"] as const).map((id) => ({
      id,
      treasury: 0,
      government: null,
    })),
    players: cash.map((amount, seat) => ({
      seat,
      kind: seat === 0 ? "human" : "ai",
      cash: amount,
      bonds: [],
      investor: false,
      swissBank: false,
    })),
  };
}

describe("map", () => {
  it("links Dijon and Brest in both directions", () => {
    expect(linked("LR6", "LR5")).toBe(true);
    expect(linked("LR5", "LR6")).toBe(true);
  });

  it("keeps every connection bidirectional and gives London its harbor", () => {
    for (const region of regions.values()) {
      for (const link of region.links) {
        expect(linked(link, region.id), `${region.id} -> ${link}`).toBe(true);
      }
    }
    expect(regions.get("LR36")?.port).toBe("SR6");
    expect(regions.get("LR14")?.home).toBe("ah");
    expect(regions.has("Switzerland")).toBe(false);
  });
});

describe("rondel and tax chart", () => {
  it("charges two million for each space past the third", () => {
    expect(rondelCost(null, 4)).toBe(0);
    expect(rondelCost(4, 0)).toBe(2);
    expect(rondelCost(4, 1)).toBe(4);
    expect(rondelCost(4, 4)).toBeNull();
    expect(rondelCost(4, 3)).toBeNull();
  });

  it("reads the tax chart the way the German example does", () => {
    expect(powerPointsForTax(5)).toBe(0);
    expect(powerPointsForTax(6)).toBe(1);
    expect(powerPointsForTax(7)).toBe(2);
    expect(powerPointsForTax(15)).toBe(10);
    expect(taxTrack(7)).toBe("tax_7");
    expect(scoreFactor(17)).toBe(3);
    expect(scoreFactor(25)).toBe(5);
  });
});

describe("experienced bond draft", () => {
  it("starts with Austria-Hungary and the first seated player", () => {
    expect(actorSeat(3, { nationIndex: 0, offerIndex: 0 })).toBe(0);
    expect(actorSeat(3, { nationIndex: 1, offerIndex: 0 })).toBe(1);
  });

  it("pays the bond into the treasury and gives the higher credit the government", () => {
    const bought = chooseBond(position([40, 40]), 0, 8);
    if ("error" in bought) {
      throw new Error(bought.error);
    }
    expect(bought.players[0]?.cash).toBe(15);
    expect(bought.nations[0]?.treasury).toBe(25);
    const finished = playAutomaticDraft(passRemaining(bought));
    expect(finished.draft).toBeNull();
    expect(finished.nations.find((nation) => nation.id === "ah")?.government).toBe(0);
    expect(finished.players[0]?.investor).toBe(false);
    expect(finished.players[1]?.investor).toBe(true);
    expect(finished.players[1]?.swissBank).toBe(true);
  });

  it("breaks an equal credit toward the first seated player and hands out the Swiss bank", () => {
    const start = position([10, 10, 10]);
    start.players[0]?.bonds.push({ nation: "ah", interest: 1, price: 4 });
    start.players[1]?.bonds.push({ nation: "ah", interest: 2, price: 4 });
    start.players[2]?.bonds.push({ nation: "ita", interest: 3, price: 6 });
    const closed = closeDraft(start);
    expect(closed.nations.find((nation) => nation.id === "ah")?.government).toBe(0);
    expect(closed.nations.find((nation) => nation.id === "ita")?.government).toBe(2);
    expect(closed.players.map((player) => player.swissBank)).toEqual([false, true, false]);
    expect(closed.players.find((player) => player.investor)?.seat).toBe(1);
  });

  it("refuses a bond the player cannot afford", () => {
    const result = chooseBond(position([10]), 0, 8);
    expect(result).toEqual({ error: "You do not have enough money for that bond." });
  });
});

function passRemaining(start: DraftPosition): DraftPosition {
  let current = start;
  while (current.draft) {
    const seat = actorSeat(current.players.length, current.draft);
    const next = chooseBond(current, seat, null);
    if ("error" in next) {
      throw new Error(next.error);
    }
    current = next;
  }
  return current;
}
