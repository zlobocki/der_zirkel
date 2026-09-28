import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAdminRoutes } from "./admin.js";
import { registerAuthRoutes } from "./auth.js";
import type { Database } from "./db.js";

export type AppOptions = {
  db: Database;
  sessionSecret: string;
  initialAdminEmail?: string;
  secureCookies?: boolean;
  logger?: boolean;
};

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });
  const webDist = path.resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));

  await app.register(cookie);

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text) as unknown);
    } catch {
      const error = new Error("Invalid request.") as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: "Invalid request." });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Something went wrong." });
  });

  app.get("/api/health", async (_request, reply) => {
    const databaseUp = await options.db.ping();
    const body = {
      ok: databaseUp,
      service: "der-zirkel",
      database: databaseUp ? "up" : "down",
    };
    return reply.code(databaseUp ? 200 : 503).send(body);
  });

  registerAuthRoutes(app, {
    sql: options.db.sql,
    sessionSecret: options.sessionSecret,
    initialAdminEmail: options.initialAdminEmail,
    secureCookies: options.secureCookies ?? false,
  });

  registerAdminRoutes(app, {
    sql: options.db.sql,
    sessionSecret: options.sessionSecret,
    secureCookies: options.secureCookies ?? false,
  });

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname.includes(".")) {
      return reply.code(404).send({ error: "Not found." });
    }
    if (existsSync(path.join(webDist, "index.html"))) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });

  return app;
}
