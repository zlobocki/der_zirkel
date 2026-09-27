import { createHmac, randomBytes, randomUUID } from "node:crypto";
import "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type postgres from "postgres";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./passwords.js";

export const SESSION_COOKIE = "dz_session";
const SESSION_DAYS = 30;

export const PRIVACY_NOTICE =
  "Zbigniew Łobocki (zbigniew.lobocki@gmail.com) stores your username and email only to run accounts and games.";

const UNFINISHED_GAME_STATUSES = ["waiting", "playing"];

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(
    /^[\p{L}\p{N}]+(?:[ '\-][\p{L}\p{N}]+)*$/u,
    "Use letters, numbers, spaces, apostrophes, or hyphens.",
  );

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(254)
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  gdprAccepted: z.literal(true, {
    errorMap: () => ({ message: "Accept the privacy notice to create an account." }),
  }),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const deleteSchema = z.object({
  password: z.string().min(1).max(128),
});

export type PublicUser = {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
};

type AuthOptions = {
  sql: postgres.Sql | null;
  sessionSecret: string;
  initialAdminEmail?: string;
  secureCookies: boolean;
};

type UserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  disabled: boolean;
};

let dummyPasswordHash: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword("not-a-real-password");
  return dummyPasswordHash;
}

function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

function cookieBase(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
}

function publicUser(row: Pick<UserRow, "id" | "username" | "email" | "is_admin">): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    isAdmin: row.is_admin,
  };
}

function fieldError(error: z.ZodError): { error: string; field?: string } {
  const issue = error.issues[0];
  return {
    error: issue?.message ?? "Check the form and try again.",
    field: issue ? String(issue.path[0]) : undefined,
  };
}

function isUniqueViolation(error: unknown): error is { code: string; constraint_name?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}

async function readSession(
  sql: postgres.Sql,
  request: FastifyRequest,
  secret: string,
): Promise<UserRow | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  const rows = await sql<UserRow[]>`
    select u.id, u.username, u.email, u.password_hash, u.is_admin, u.disabled
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token, secret)}
      and s.expires_at > now()
  `;
  const user = rows[0];
  if (!user || user.disabled) {
    if (user?.disabled) {
      await sql`delete from sessions where token_hash = ${hashToken(token, secret)}`;
    }
    return null;
  }
  return user;
}

async function startSession(
  sql: postgres.Sql,
  reply: FastifyReply,
  userId: string,
  secret: string,
  secure: boolean,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into sessions (id, user_id, token_hash, expires_at)
    values (${randomUUID()}, ${userId}::uuid, ${hashToken(token, secret)}, now() + interval '30 days')
  `;
  reply.setCookie(SESSION_COOKIE, token, {
    ...cookieBase(secure),
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

function clearSession(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, cookieBase(secure));
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthOptions): void {
  const { sql, sessionSecret, secureCookies } = options;
  const adminEmail = options.initialAdminEmail?.trim().toLowerCase() ?? "";

  function databaseDown(reply: FastifyReply) {
    return reply.code(503).send({ error: "Database is not connected." });
  }

  app.get("/api/auth/me", async (request, reply) => {
    if (!sql) {
      return databaseDown(reply);
    }
    const user = await readSession(sql, request, sessionSecret);
    if (!user) {
      clearSession(reply, secureCookies);
      return { user: null };
    }
    return { user: publicUser(user) };
  });

  app.post("/api/auth/register", async (request, reply) => {
    if (!sql) {
      return databaseDown(reply);
    }
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    const { username, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      const rows = await sql<UserRow[]>`
        insert into users (
          id, username, username_normalized, email, password_hash, gdpr_accepted_at, is_admin
        )
        values (
          ${randomUUID()},
          ${username},
          ${username.toLowerCase()},
          ${email},
          ${passwordHash},
          now(),
          ${adminEmail !== "" && email === adminEmail}
        )
        returning id, username, email, password_hash, is_admin, disabled
      `;
      const user = rows[0];
      if (!user) {
        return reply.code(500).send({ error: "Something went wrong." });
      }
      await startSession(sql, reply, user.id, sessionSecret, secureCookies);
      return reply.code(201).send({ user: publicUser(user) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = error.constraint_name ?? "";
        if (constraint.includes("email")) {
          return reply.code(409).send({ error: "That email is already registered.", field: "email" });
        }
        return reply.code(409).send({ error: "That username is already taken.", field: "username" });
      }
      throw error;
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (!sql) {
      return databaseDown(reply);
    }
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    const rows = await sql<UserRow[]>`
      select id, username, email, password_hash, is_admin, disabled
      from users
      where email = ${parsed.data.email}
    `;
    const user = rows[0];
    const passwordMatches = await verifyPassword(parsed.data.password, user?.password_hash ?? (await dummyHash()));
    if (!user || !passwordMatches) {
      return reply.code(401).send({ error: "Email or password is incorrect." });
    }
    if (user.disabled) {
      return reply.code(403).send({ error: "This account is disabled." });
    }
    await startSession(sql, reply, user.id, sessionSecret, secureCookies);
    return { user: publicUser(user) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (sql) {
      const token = request.cookies[SESSION_COOKIE];
      if (token) {
        await sql`delete from sessions where token_hash = ${hashToken(token, sessionSecret)}`;
      }
    }
    clearSession(reply, secureCookies);
    return { ok: true };
  });

  app.delete("/api/auth/account", async (request, reply) => {
    if (!sql) {
      return databaseDown(reply);
    }
    const user = await readSession(sql, request, sessionSecret);
    if (!user) {
      clearSession(reply, secureCookies);
      return reply.code(401).send({ error: "Log in to delete this account." });
    }
    const parsed = deleteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Enter your password to delete the account.", field: "password" });
    }
    const passwordMatches = await verifyPassword(parsed.data.password, user.password_hash);
    if (!passwordMatches) {
      return reply.code(401).send({ error: "Password is incorrect.", field: "password" });
    }
    const unfinished = await sql<{ id: string }[]>`
      select g.id
      from game_players gp
      join games g on g.id = gp.game_id
      where gp.user_id = ${user.id}::uuid
        and g.status in ${sql(UNFINISHED_GAME_STATUSES)}
      limit 1
    `;
    if (unfinished.length > 0) {
      return reply.code(409).send({
        error: "This account is in a game that has not finished. Deletion waits until that game is over.",
      });
    }
    await sql`delete from users where id = ${user.id}::uuid`;
    clearSession(reply, secureCookies);
    return { ok: true };
  });
}
