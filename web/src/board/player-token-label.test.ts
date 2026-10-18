import { describe, expect, it } from "vitest";
import { playerTokenLabel } from "./player-token-label";

describe("player token initials", () => {
  it("numbers matching initials in seat order, independently of player array order", () => {
    const players = [{ seat: 2, username: "anna" }, { seat: 1, username: "Bea" }, { seat: 0, username: "Adam" }];
    expect(playerTokenLabel(players, 0)).toEqual({ initial: "A", number: 1 });
    expect(playerTokenLabel(players, 2)).toEqual({ initial: "A", number: 2 });
    expect(playerTokenLabel(players, 1)).toEqual({ initial: "B", number: null });
  });
  it("supports Unicode names and uses only the first letter", () => {
    const players = [{ seat: 0, username: " łukasz" }, { seat: 1, username: "Łucja" }, { seat: 2, username: "12-Zofia" }];
    expect(playerTokenLabel(players, 0)).toEqual({ initial: "Ł", number: 1 });
    expect(playerTokenLabel(players, 1)).toEqual({ initial: "Ł", number: 2 });
    expect(playerTokenLabel(players, 2)).toEqual({ initial: "Z", number: null });
  });
  it("has a fallback for empty or unoccupied seats", () => {
    expect(playerTokenLabel([{ seat: 0, username: null }], 0)).toEqual({ initial: "?", number: null });
    expect(playerTokenLabel([], 5)).toEqual({ initial: "?", number: null });
  });
});
