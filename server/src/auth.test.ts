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

describe("accounts", () => {
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

  it("requires the privacy acceptance, then creates a session", async () => {
    const rejected = await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: false,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toMatch(/privacy notice/i);

    const created = await register({
      username: "Ada",
      email: "Ada@Example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user).toMatchObject({
      username: "Ada",
      email: "ada@example.com",
      isAdmin: false,
    });

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookiePair(created) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("ada@example.com");
  });

  it("promotes the configured administrator email", async () => {
    const created = await register({
      username: "Owner",
      email: "owner@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    expect(created.json().user.isAdmin).toBe(true);
  });

  it("rejects a duplicate username regardless of case", async () => {
    await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const duplicate = await register({
      username: "ada",
      email: "other@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().field).toBe("username");
  });

  it("logs in, logs out, and rejects a wrong password", async () => {
    await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "nope-nope" },
    });
    expect(wrong.statusCode).toBe(401);

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "correct-horse" },
    });
    expect(loggedIn.statusCode).toBe(200);
    const cookie = cookiePair(loggedIn);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, "content-type": "application/json" },
      payload: "",
    });
    expect(loggedOut.statusCode).toBe(200);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(me.json().user).toBeNull();
  });

  it("refuses deletion during an unfinished game, then deletes the account", async () => {
    const created = await register({
      username: "Ada",
      email: "ada@example.com",
      password: "correct-horse",
      gdprAccepted: true,
    });
    const cookie = cookiePair(created);
    const userId = created.json().user.id as string;
    const gameId = randomUUID();
    await sql`
      insert into games (id, status)
      values (${gameId}::uuid, 'playing')
    `;
    await sql`
      insert into game_players (game_id, user_id)
      values (${gameId}::uuid, ${userId}::uuid)
    `;

    const blocked = await app.inject({
      method: "DELETE",
      url: "/api/auth/account",
      headers: { cookie },
      payload: { password: "correct-horse" },
    });
    expect(blocked.statusCode).toBe(409);

    await sql`update games set status = 'finished' where id = ${gameId}::uuid`;
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/auth/account",
      headers: { cookie },
      payload: { password: "correct-horse" },
    });
    expect(deleted.statusCode).toBe(200);

    const remaining = await sql<{ count: string }[]>`
      select count(*)::text as count from users where id = ${userId}::uuid
    `;
    expect(remaining[0]?.count).toBe("0");
  });
});
