import { randomUUID } from "node:crypto";
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

describe("admin accounts", () => {
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
      initialAdminEmail: "owner@example.com",
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

  async function register(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/auth/register", payload: body });
  }

  it("refuses the account list until an administrator is signed in", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/admin/users" });
    expect(missing.statusCode).toBe(401);

    const player = await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: cookiePair(player) },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("creates a player account and lists it for the administrator", async () => {
    const owner = await register({
      username: "Owner",
      email: "owner@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const cookie = cookiePair(owner);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie },
      payload: {
        username: "Bea",
        email: "bea@example.com",
        password: "correct-horse",
        gdprAccepted: false,
      },
    });
    expect(rejected.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie },
      payload: {
        username: "Bea",
        email: "Bea@Example.com",
        password: "correct-horse",
        gdprAccepted: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user).toMatchObject({
      username: "Bea",
      email: "bea@example.com",
      isAdmin: false,
      disabled: false,
    });

    const listed = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().users).toEqual([
      expect.objectContaining({ email: "owner@example.com", isAdmin: true }),
      expect.objectContaining({ email: "bea@example.com", isAdmin: false }),
    ]);
  });

  it("disables another account, blocks self-disable, and drops that player's session", async () => {
    const owner = await register({
      username: "Owner",
      email: "owner@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const ownerCookie = cookiePair(owner);
    const player = await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const playerCookie = cookiePair(player);
    const playerId = player.json().user.id as string;

    const self = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${owner.json().user.id}`,
      headers: { cookie: ownerCookie },
      payload: { disabled: true },
    });
    expect(self.statusCode).toBe(409);

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${playerId}`,
      headers: { cookie: ownerCookie },
      payload: { disabled: true },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().user.disabled).toBe(true);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: playerCookie },
    });
    expect(me.json().user).toBeNull();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "correct-horse" },
    });
    expect(login.statusCode).toBe(403);

    const enabled = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${playerId}`,
      headers: { cookie: ownerCookie },
      payload: { disabled: false },
    });
    expect(enabled.json().user.disabled).toBe(false);
  });

  it("replaces a password and ends that account's sessions", async () => {
    const owner = await register({
      username: "Owner",
      email: "owner@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const ownerCookie = cookiePair(owner);
    const player = await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const playerCookie = cookiePair(player);
    const playerId = player.json().user.id as string;

    const reset = await app.inject({
      method: "POST",
      url: `/api/admin/users/${playerId}/password`,
      headers: { cookie: ownerCookie },
      payload: { password: "new-password" },
    });
    expect(reset.statusCode).toBe(200);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: playerCookie },
    });
    expect(oldSession.json().user).toBeNull();

    const oldPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "correct-horse" },
    });
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "new-password" },
    });
    expect(newPassword.statusCode).toBe(200);

    const ownerStillIn = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie },
    });
    expect(ownerStillIn.json().user.email).toBe("owner@example.com");
  });

  it("refuses to delete the signed-in administrator or a player in an unfinished game", async () => {
    const owner = await register({
      username: "Owner",
      email: "owner@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const cookie = cookiePair(owner);
    const player = await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const playerId = player.json().user.id as string;
    const gameId = randomUUID();
    await sql`
      insert into games (id, status)
      values (${gameId}::uuid, 'playing')
    `;
    await sql`
      insert into game_players (game_id, user_id)
      values (${gameId}::uuid, ${playerId}::uuid)
    `;

    const self = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${owner.json().user.id}`,
      headers: { cookie },
    });
    expect(self.statusCode).toBe(409);

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${playerId}`,
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(409);

    await sql`update games set status = 'finished' where id = ${gameId}::uuid`;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${playerId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);

    const remaining = await sql<{ count: string }[]>`
      select count(*)::text as count from users where id = ${playerId}::uuid
    `;
    expect(remaining[0]?.count).toBe("0");
  });
});
