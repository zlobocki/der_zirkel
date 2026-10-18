import Fastify, { type FastifyInstance } from "fastify";
import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth.js";
import { registerGameEvents } from "./game-events.js";

const gameId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const user = { id: "player-id" } as SessionUser;

describe("game event streams", () => {
  let app: FastifyInstance;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  afterEach(async () => {
    await Promise.all(readers.splice(0).map((reader) => reader.cancel()));
    await app.close();
  });

  async function setup({ signedIn = true, seated = true } = {}) {
    let notify: (id: string) => void = () => {};
    let reconnect: () => void = () => {};
    const unlisten = vi.fn(async () => {});
    const query = vi.fn(async () => seated ? [{ id: gameId }] : []);
    const listen = vi.fn(async (_channel, callback, onlisten) => {
      notify = callback;
      reconnect = onlisten;
      return { unlisten };
    });
    const sql = Object.assign(query, { listen }) as unknown as postgres.Sql;
    app = Fastify();
    registerGameEvents(app, sql, async (_request, reply) => {
      if (signedIn) return user;
      await reply.code(401).send({ error: "Log in." });
      return null;
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    return { address, query, listen, unlisten, notify: (id: string) => notify(id), reconnect: () => reconnect() };
  }

  async function open(address: string, id = gameId) {
    const response = await fetch(`${address}/api/games/${id}/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader = response.body!.getReader();
    readers.push(reader);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: changed");
    return reader;
  }

  it("requires sign-in before starting a stream", async () => {
    const { address, listen } = await setup({ signedIn: false });
    const response = await fetch(`${address}/api/games/${gameId}/events`);
    expect(response.status).toBe(401);
    expect(listen).not.toHaveBeenCalled();
  });

  it("rejects unseated users even for waiting games", async () => {
    const { address, listen } = await setup({ seated: false });
    expect((await fetch(`${address}/api/games/${gameId}/events`)).status).toBe(403);
    expect(listen).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs without querying the database", async () => {
    const { address, query } = await setup();
    expect((await fetch(`${address}/api/games/invalid/events`)).status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it("pushes invalidations to all players of the changed game only", async () => {
    const server = await setup();
    const first = await open(server.address);
    const second = await open(server.address);
    const other = await open(server.address, otherId);
    server.notify(gameId);
    for (const reader of [first, second]) {
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: changed\ndata: {}\n\n");
    }
    server.notify(otherId);
    // No notification for the first game should have been queued on this stream.
    expect(new TextDecoder().decode((await other.read()).value)).toBe("event: changed\ndata: {}\n\n");
    expect(server.listen).toHaveBeenCalledTimes(1);
  });

  it("refreshes all connected clients after a database reconnect and cleans up on shutdown", async () => {
    const server = await setup();
    const reader = await open(server.address);
    server.reconnect();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: changed");
    await app.close();
    expect(server.unlisten).toHaveBeenCalledOnce();
    expect((await reader.read()).done).toBe(true);
  });
});
