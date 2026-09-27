import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { Database } from "./db.js";

function fakeDb(up: boolean): Database {
  return {
    async ping() {
      return up;
    },
    async close() {},
  };
}

describe("GET /api/health", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("reports the database as up", async () => {
    const app = await buildApp({ db: fakeDb(true) });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "der-zirkel",
      database: "up",
    });
  });

  it("reports the database as down when Postgres cannot be reached", async () => {
    const app = await buildApp({ db: fakeDb(false) });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      service: "der-zirkel",
      database: "down",
    });
  });
});
