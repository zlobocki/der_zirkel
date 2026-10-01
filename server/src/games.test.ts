import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { migrate } from "./migrate.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://der_zirkel:der_zirkel@127.0.0.1:5432/der_zirkel_test";
const sessionSecret = "test-session-secret";

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });

function cookiePair(response: { headers: { "set-cookie"?: unknown } }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : [raw];
  const header = values.find((value): value is string => typeof value === "string" && value.startsWith("dz_session="));
  const pair = header?.split(";")[0];
  if (!pair?.startsWith("dz_session=")) {
    throw new Error(`session cookie missing: ${String(header)}`);
  }
  return pair;
}

describe("lobby", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await migrate(sql);
    app = await buildApp({
      db: {
        sql,
        async ping() {
          await sql`select 1`;
          return true;
        },
        async close() {},
      },
      sessionSecret,
      secureCookies: false,
      logger: false,
    });
  });

  beforeEach(async () => {
    await sql`truncate table game_players, games, sessions, users cascade`;
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  async function register(username: string, email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username, email, password: "correct-horse", gdprAccepted: true },
    });
    expect(response.statusCode).toBe(201);
    return { cookie: cookiePair(response), id: response.json().user.id as string };
  }

  it("requires a signed-in player", async () => {
    const response = await app.inject({ method: "GET", url: "/api/games" });
    expect(response.statusCode).toBe(401);
  });

  it("seats the creator, fills AI immediately, and starts a solo game", async () => {
    const ada = await register("Ada", "ada@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Solo Table", password: "open-sesame", humanSeats: 1, aiSeats: 2 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().game).toMatchObject({
      name: "Solo Table",
      status: "playing",
      humanSeats: 1,
      aiSeats: 2,
      seatedHumans: 1,
      yourSeat: 0,
      createdByYou: true,
    });
    expect(created.json().game.seats).toEqual([
      { seat: 0, kind: "human", username: "Ada", you: true },
      { seat: 1, kind: "ai", username: "AI 1", you: false },
      { seat: 2, kind: "ai", username: "AI 2", you: false },
    ]);
    expect(JSON.stringify(created.json())).not.toContain("scrypt$");

    const stored = await sql<{
      state: {
        phase: string;
        seats: Array<{ userId: string | null }>;
        board: {
          players: Array<{ cash: number }>;
          nations: Array<{ id: string; factories: Array<{ region: string; kind: string }> }>;
        };
      };
    }[]>`
      select state from games where id = ${created.json().game.id}::uuid
    `;
    expect(stored[0]?.state.phase).toBe("playing");
    expect(stored[0]?.state.seats.map((seat) => seat.userId)).toEqual([ada.id, null, null]);
    expect(stored[0]?.state.board.players[0]?.cash).toBe(28);
    expect(stored[0]?.state.board.nations.find((nation) => nation.id === "ah")?.factories).toEqual([
      { region: "LR14", kind: "land" },
      { region: "LR16", kind: "land" },
    ]);
  });

  it("starts when the last person joins, then only those players can enter", async () => {
    const ada = await register("Ada", "ada@example.com");
    const bea = await register("Bea", "bea@example.com");
    const cy = await register("Cleo", "cleo@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Alpine", password: "open-sesame", humanSeats: 2, aiSeats: 1 },
    });
    const gameId = created.json().game.id as string;
    expect(created.json().game.status).toBe("waiting");

    const wrong = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/join`,
      headers: { cookie: bea.cookie },
      payload: { password: "nope" },
    });
    expect(wrong.statusCode).toBe(401);

    const joined = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/join`,
      headers: { cookie: bea.cookie },
      payload: { password: "open-sesame" },
    });
    expect(joined.statusCode).toBe(201);
    expect(joined.json().game).toMatchObject({ status: "playing", yourSeat: 1, seatedHumans: 2 });
    expect(joined.json().game.seats.map((seat: { username: string | null }) => seat.username)).toEqual([
      "Ada",
      "Bea",
      "AI 1",
    ]);

    const outsider = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/join`,
      headers: { cookie: cy.cookie },
      payload: { password: "open-sesame" },
    });
    expect(outsider.statusCode).toBe(403);

    const rejoin = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/join`,
      headers: { cookie: ada.cookie },
      payload: { password: "open-sesame" },
    });
    expect(rejoin.statusCode).toBe(200);
    expect(rejoin.json().game.yourSeat).toBe(0);

    const listed = await app.inject({ method: "GET", url: "/api/games", headers: { cookie: bea.cookie } });
    expect(listed.json().yours).toEqual([expect.objectContaining({ id: gameId, status: "playing" })]);
    expect(listed.json().open).toEqual([]);

    const hidden = await app.inject({ method: "GET", url: "/api/games", headers: { cookie: cy.cookie } });
    expect(hidden.json().yours).toEqual([]);
    expect(hidden.json().open).toEqual([]);

    const asBea = await app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: { cookie: bea.cookie } });
    expect(asBea.statusCode).toBe(200);
    const beaPlayers = asBea.json().game.board.players as Array<{ you: boolean; cash: number | null; kind: string }>;
    expect(beaPlayers.find((player) => player.you)?.cash).toBe(28);
    expect(beaPlayers.filter((player) => !player.you).every((player) => player.cash === null)).toBe(true);

    const outsiderView = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}`,
      headers: { cookie: cy.cookie },
    });
    expect(outsiderView.statusCode).toBe(403);
  });

  it("lets the creator cancel a game that is still waiting", async () => {
    const ada = await register("Ada", "ada@example.com");
    const bea = await register("Bea", "bea@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Waiting Room", password: "open-sesame", humanSeats: 3, aiSeats: 0 },
    });
    const gameId = created.json().game.id as string;
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/join`,
      headers: { cookie: bea.cookie },
      payload: { password: "open-sesame" },
    });

    const denied = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/cancel`,
      headers: { cookie: bea.cookie },
    });
    expect(denied.statusCode).toBe(403);

    const left = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/leave`,
      headers: { cookie: bea.cookie },
    });
    expect(left.statusCode).toBe(200);

    const rejoined = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/join`,
      headers: { cookie: bea.cookie },
      payload: { password: "open-sesame" },
    });
    expect(rejoined.json().game.yourSeat).toBe(1);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/cancel`,
      headers: { cookie: ada.cookie },
    });
    expect(cancelled.statusCode).toBe(200);

    const lobby = await app.inject({ method: "GET", url: "/api/games", headers: { cookie: ada.cookie } });
    expect(lobby.json().yours).toEqual([]);
    expect(lobby.json().open).toEqual([]);

    const replacement = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "waiting room", password: "open-sesame", humanSeats: 2, aiSeats: 0 },
    });
    expect(replacement.statusCode).toBe(201);

    const started = await app.inject({
      method: "POST",
      url: `/api/games/${replacement.json().game.id}/join`,
      headers: { cookie: bea.cookie },
      payload: { password: "open-sesame" },
    });
    const tooLate = await app.inject({
      method: "POST",
      url: `/api/games/${replacement.json().game.id}/cancel`,
      headers: { cookie: ada.cookie },
    });
    expect(started.statusCode).toBe(201);
    expect(tooLate.statusCode).toBe(409);
  });

  it("lets the creator delete a game that has already started", async () => {
    const ada = await register("Ada", "ada-delete@example.com");
    const bea = await register("Bea", "bea-delete@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Old Table", password: "open-sesame", humanSeats: 1, aiSeats: 0 },
    });
    const gameId = created.json().game.id as string;
    const denied = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/delete`,
      headers: { cookie: bea.cookie },
    });
    expect(denied.statusCode).toBe(403);

    const deleted = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/delete`,
      headers: { cookie: ada.cookie },
    });
    expect(deleted.statusCode).toBe(200);

    const lobby = await app.inject({ method: "GET", url: "/api/games", headers: { cookie: ada.cookie } });
    expect(lobby.json().yours).toEqual([]);
    const missing = await app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: { cookie: ada.cookie } });
    expect(missing.statusCode).toBe(404);

    const again = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Old Table", password: "open-sesame", humanSeats: 1, aiSeats: 0 },
    });
    expect(again.statusCode).toBe(201);
  });

  it("lets the first player pass a bond and then the automatic players buy", async () => {
    const ada = await register("Ada", "ada@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Bond Table", password: "open-sesame", humanSeats: 1, aiSeats: 2 },
    });
    const gameId = created.json().game.id as string;
    const opened = await app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: { cookie: ada.cookie } });
    expect(opened.json().game.board.draft).toMatchObject({ nationId: "ah", yours: true });

    const passed = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/draft`,
      headers: { cookie: ada.cookie },
      payload: { interest: null },
    });
    expect(passed.statusCode).toBe(200);
    expect(passed.json().game.board.draft).toMatchObject({ nationId: "ita", yours: true });
    expect(passed.json().game.board.players.find((player: { you: boolean }) => player.you).cash).toBe(28);
    expect(passed.json().game.board.nations.find((nation: { id: string }) => nation.id === "ah").treasury).toBe(6);

    const early = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/draft`,
      headers: { cookie: ada.cookie },
      payload: { interest: 9 },
    });
    expect(early.statusCode).toBe(409);
  });

  it("lets the government tax and then undo that turn", async () => {
    const ada = await register("Ada", "ada@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Turn Table", password: "open-sesame", humanSeats: 1, aiSeats: 0 },
    });
    const gameId = created.json().game.id as string;
    const bought = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/draft`,
      headers: { cookie: ada.cookie },
      payload: { interest: 1 },
    });
    expect(bought.statusCode).toBe(200);
    for (let step = 0; step < 5; step += 1) {
      const passed = await app.inject({
        method: "POST",
        url: `/api/games/${gameId}/draft`,
        headers: { cookie: ada.cookie },
        payload: { interest: null },
      });
      expect(passed.statusCode).toBe(200);
    }
    const taxed = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/turn`,
      headers: { cookie: ada.cookie },
      payload: { action: "rondel", index: 0 },
    });
    expect(taxed.statusCode).toBe(200);
    expect(taxed.json().game.board.nations.find((nation: { id: string }) => nation.id === "ah").treasury).toBe(6);
    expect(taxed.json().game.board.turn.phase).toBe("confirm");
    const undone = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/turn`,
      headers: { cookie: ada.cookie },
      payload: { action: "undo" },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().game.board.nations.find((nation: { id: string }) => nation.id === "ah")).toMatchObject({
      treasury: 2,
      rondel: "Rondelcenter",
    });
  });

  it("rejects an impossible seat count and a duplicate open name", async () => {
    const ada = await register("Ada", "ada@example.com");
    const tooMany = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Crowded", password: "open-sesame", humanSeats: 4, aiSeats: 3 },
    });
    expect(tooMany.statusCode).toBe(400);

    await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "Danube", password: "open-sesame", humanSeats: 2, aiSeats: 0 },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: ada.cookie },
      payload: { name: "danube", password: "other-pass", humanSeats: 2, aiSeats: 0 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().field).toBe("name");
  });
});
