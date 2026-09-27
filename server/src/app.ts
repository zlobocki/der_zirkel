import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "./db.js";

export type AppOptions = {
  db: Database;
};

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get("/api/health", async (_request, reply) => {
    const databaseUp = await options.db.ping();
    const body = {
      ok: databaseUp,
      service: "der-zirkel",
      database: databaseUp ? "up" : "down",
    };
    return reply.code(databaseUp ? 200 : 503).send(body);
  });

  const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: path.resolve(webDist),
    });
  }

  return app;
}
