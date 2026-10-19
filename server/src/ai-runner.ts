import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { ensurePlay, pendingAI, stepAI, type Board } from "./rules/turn.js";

export const AI_MOVE_DELAY_MS = 1200;
export function nextAIMove(board: Board | null, delay = AI_MOVE_DELAY_MS, now = Date.now()): Date | null {
  return board && pendingAI(board) !== null ? new Date(now + delay) : null;
}

/** No overlapping ticks, and shutdown waits for a running transaction. */
export function pacedLoop(step: () => Promise<void>, interval: number, onError: (error: unknown) => void): () => Promise<void> {
  let running: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (!running) running = step().catch(onError).finally(() => { running = null; });
  }, interval);
  timer.unref();
  return async () => { clearInterval(timer); await running; };
}

export function registerAIRunner(app: FastifyInstance, sql: postgres.Sql | null, delay = AI_MOVE_DELAY_MS): void {
  if (!sql) return;
  let stop: (() => Promise<void>) | undefined;
  app.addHook("onReady", async () => {
    // Recover old games and work interrupted by a restart. Human turns are
    // cleared by the runner without advancing the board.
    await sql`update games set ai_next_move_at = now() where status = 'playing' and ai_next_move_at is null and state -> 'board' is not null`;
    stop = pacedLoop(async () => {
      for (let batch = 0; batch < 4; batch += 1) {
        const found = await sql.begin(async (tx) => {
          const rows = await tx<Array<{ id: string; state: { board?: Board; [key: string]: unknown } }>>`
            select id, state from games where status = 'playing' and ai_next_move_at <= now()
            order by ai_next_move_at limit 1 for update skip locked
          `;
          const game = rows[0];
          if (!game) return false;
          if (!game.state.board) {
            await tx`update games set ai_next_move_at = null where id = ${game.id}::uuid`;
            return true;
          }
          const before = ensurePlay(game.state.board, false);
          const result = stepAI(before);
          if ("error" in result) throw new Error(`AI action failed for ${game.id}: ${result.error}`);
          const status = result.finished ? "finished" : "playing";
          const next = nextAIMove(result, delay);
          // Each transaction commits one action. PostgreSQL then notifies all
          // browsers, and the next action cannot run before its due time.
          await tx`update games set status = ${status}, state = ${tx.json({ ...game.state, phase: status, board: result })}, ai_next_move_at = ${next}
            where id = ${game.id}::uuid`;
          return true;
        });
        if (!found) break;
      }
    }, Math.min(250, delay), (error) => app.log.error(error));
  });
  app.addHook("preClose", async () => { await stop?.(); });
}
