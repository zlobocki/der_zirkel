import { describe, expect, it } from "vitest";
import type { BoardView } from "../api";
import { activePlayerKey } from "./turn-notification";

const board = (turn: Partial<NonNullable<BoardView["turn"]>> = {}, draft: BoardView["draft"] = null): BoardView => ({
  finished: false, draft,
  turn: { yours: true, actorSeat: 0, nationId: "ah", phase: "rondel", ...turn },
} as BoardView);

describe("turn notification recipients", () => {
  it("stays silent for other players, finished games and AI holds", () => {
    expect(activePlayerKey(null)).toBeNull();
    expect(activePlayerKey(board({ yours: false }))).toBeNull();
    expect(activePlayerKey(board({ phase: "hold", actorSeat: null }))).toBeNull();
    expect(activePlayerKey({ ...board(), finished: true })).toBeNull();
  });
  it("does not retrigger for repeated snapshots or phases within a player's action", () => {
    expect(activePlayerKey(board())).toBe(activePlayerKey(board()));
    expect(activePlayerKey(board({ phase: "fleets" }))).toBe(activePlayerKey(board({ phase: "armies" })));
    expect(activePlayerKey(board({ phase: "confirm" }))).toBe(activePlayerKey(board({ phase: "factory" })));
  });
  it("recognizes a newly active buyer or country", () => {
    expect(activePlayerKey(board({ phase: "invest" }))).not.toBe(activePlayerKey(board()));
    expect(activePlayerKey(board({ nationId: "ita" }))).not.toBe(activePlayerKey(board()));
    expect(activePlayerKey(board({ phase: "invest", actorSeat: 1 }))).not.toBe(activePlayerKey(board({ phase: "invest", actorSeat: 0 })));
  });
  it("only notifies the player choosing an opening bond", () => {
    const draft = { nationId: "ah", seat: 0, yours: true, choices: [] };
    expect(activePlayerKey(board({}, draft))).toBe("draft:ah:0");
    expect(activePlayerKey(board({}, { ...draft, yours: false }))).toBeNull();
  });
});
