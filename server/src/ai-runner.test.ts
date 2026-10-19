import Fastify from "fastify";
import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_MOVE_DELAY_MS, nextAIMove, pacedLoop, registerAIRunner } from "./ai-runner.js";
import { NATION_ORDER } from "./rules/constants.js";
import { openingPiles } from "./rules/draft.js";
import { ensurePlay, pendingAI, performTurn, stepAI, type Board } from "./rules/turn.js";

function table(): Board {
  return {
    nations: NATION_ORDER.map((id, index) => ({ id, score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: index % 3, factories: [] })),
    players: [0, 1, 2].map((seat) => ({ seat, kind: seat < 2 ? "ai" : "human", username: `Player ${seat + 1}`, userId: seat === 2 ? "human" : null, cash: 28, bonds: [], investor: false, swissBank: false })),
    draft: { nationIndex: 0, offerIndex: 0 }, piles: openingPiles(), units: [], flags: [], nextUnit: 1, finished: false, turn: null,
  };
}
function ok(board: Board | { error: string }): Board {
  if ("error" in board) throw new Error(board.error);
  return board;
}
afterEach(() => { vi.useRealTimers(); });

describe("individual AI actions", () => {
  it("does not advance AI during board preparation, then buys one opening bond per step", () => {
    const before = ensurePlay(table(), false);
    expect(before.players.every((player) => player.bonds.length === 0)).toBe(true);
    const first = ok(stepAI(before));
    expect(first.players.map((player) => player.bonds.length)).toEqual([1, 0, 0]);
    expect(first.log).toHaveLength(1);
    expect(first.log?.[0].actorSeat).toBe(0);
    expect(pendingAI(first)).toBe(1);
    const second = ok(stepAI(first));
    expect(second.players.map((player) => player.bonds.length)).toEqual([1, 1, 0]);
    expect(second.log).toHaveLength(2);
    expect(pendingAI(second)).toBeNull();
    expect(stepAI(second)).toBe(second);
    expect(before.players[0].bonds).toHaveLength(0);
  });

  it("schedules only pending computer actions, never human turns or finished games", () => {
    const board = table();
    expect(nextAIMove(board, AI_MOVE_DELAY_MS, 1000)?.getTime()).toBe(2200);
    board.draft!.offerIndex = 2;
    expect(nextAIMove(board)).toBeNull();
    board.finished = true;
    expect(nextAIMove(board)).toBeNull();
  });

  it("returns the human action without chaining the next computer turn", () => {
    const board = table();
    board.draft = null;
    board.players[0].kind = "human";
    board.players[1].kind = "ai";
    const ready = ensurePlay(board, false);
    const tax = ok(performTurn(ready, 0, { action: "rondel", index: 0 }, false));
    const handoff = ok(performTurn(tax, 0, { action: "confirm" }, false));
    expect(handoff.turn?.nationId).toBe("ita");
    expect(pendingAI(handoff)).toBe(1);
    expect(handoff.log).toHaveLength(2);
    const moved = ok(stepAI(handoff));
    expect(moved.log).toHaveLength(3);
    expect(moved.log?.at(-1)?.actorSeat).toBe(1);
    expect(ensurePlay(moved, false).log).toHaveLength(3);
  });
});

describe("paced server runner", () => {
  it("waits for each due time, persists intermediate states, and stops on a human", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const game = { id: "11111111-1111-4111-8111-111111111111", state: { board: table(), phase: "playing" }, due: 1200 as number | null };
    const committed: Board[] = [];
    const query = Object.assign(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      if (text.includes("select id, state")) return game.due !== null && game.due <= Date.now() ? [{ id: game.id, state: game.state }] : [];
      if (text.includes("set status")) {
        game.state = values[1] as typeof game.state;
        game.due = values[2] instanceof Date ? values[2].getTime() : null;
        committed.push(structuredClone(game.state.board));
      }
      return [];
    }, { json: (value: unknown) => value });
    const sql = Object.assign(async () => [], { begin: async (callback: (tx: unknown) => Promise<unknown>) => callback(query) }) as unknown as postgres.Sql;
    const app = Fastify();
    registerAIRunner(app, sql, 1200);
    try {
      await app.ready();
      await vi.advanceTimersByTimeAsync(1199);
      expect(committed).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(51);
      expect(committed).toHaveLength(1);
      expect(committed[0].players.map((player) => player.bonds.length)).toEqual([1, 0, 0]);
      await vi.advanceTimersByTimeAsync(1199);
      expect(committed).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(51);
      expect(committed).toHaveLength(2);
      expect(committed[1].players.map((player) => player.bonds.length)).toEqual([1, 1, 0]);
      expect(game.due).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      expect(committed).toHaveLength(2);
    } finally { await app.close(); }
  });

  it("never overlaps jobs and waits for an in-flight action during shutdown", async () => {
    vi.useFakeTimers();
    let done!: () => void;
    const step = vi.fn(() => new Promise<void>((resolve) => { done = resolve; }));
    const stop = pacedLoop(step, 10, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(step).toHaveBeenCalledTimes(1);
    let stopped = false;
    const closing = stop().then(() => { stopped = true; });
    expect(stopped).toBe(false);
    done(); await closing;
    await vi.advanceTimersByTimeAsync(100);
    expect(step).toHaveBeenCalledTimes(1);
  });
});
