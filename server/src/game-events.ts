import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type postgres from "postgres";
import type { SessionUser } from "./auth.js";

export function registerGameEvents(
  app: FastifyInstance,
  sql: postgres.Sql | null,
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<SessionUser | null>,
): void {
  const clients = new Map<PassThrough, string>();
  let listener: ReturnType<postgres.Sql["listen"]> | undefined;
  const changed = (gameId?: string) => {
    for (const [stream, id] of clients) {
      if (!gameId || id === gameId) {
        // Slow clients reconnect instead of accumulating an unbounded queue.
        if (!stream.write("event: changed\ndata: {}\n\n")) stream.destroy();
      }
    }
  };
  app.addHook("preClose", async () => {
    for (const stream of clients.keys()) stream.end();
    if (listener) await (await listener).unlisten();
  });

  app.get("/api/games/:id/events", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) return;
    const { id } = request.params as { id: string };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return reply.code(404).send({ error: "That game does not exist." });
    }
    const seated = await sql`
      select g.id from games g join game_players gp on gp.game_id = g.id
      where g.id = ${id}::uuid and gp.user_id = ${user.id}::uuid
        and g.status in ('waiting', 'playing', 'finished')
    `;
    if (!seated.length) return reply.code(403).send({ error: "You are not seated at this game." });
    listener ??= sql.listen("game_changed", changed, () => changed());
    try {
      await listener;
    } catch (error) {
      listener = undefined;
      throw error;
    }
    const stream = new PassThrough();
    clients.set(stream, id.toLowerCase());
    const heartbeat = setInterval(() => {
      if (!stream.write(": keep-alive\n\n")) stream.destroy();
    }, 15_000);
    stream.once("close", () => {
      clearInterval(heartbeat);
      clients.delete(stream);
    });
    reply.raw.once("close", () => stream.destroy());
    reply.header("Content-Type", "text/event-stream")
      .header("Cache-Control", "no-cache, no-transform")
      .header("X-Accel-Buffering", "no");
    // Always fetch on connection/reconnection to cover changes while offline.
    stream.write("retry: 2000\nevent: changed\ndata: {}\n\n");
    return reply.send(stream);
  });
}
