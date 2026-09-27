import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { createDb } from "./db.js";
import { migrate } from "./migrate.js";

const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const sessionSecret = process.env.SESSION_SECRET ?? "";
if (sessionSecret.length < 16) {
  console.error("SESSION_SECRET must be set to a string of at least 16 characters.");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);
if (db.sql) {
  await migrate(db.sql);
}

const secureCookies =
  process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

const app = await buildApp({
  db,
  sessionSecret,
  initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL,
  secureCookies,
});

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await db.close();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => db.close());
  });
}
