import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type postgres from "postgres";
import { z } from "zod";
import {
  accountConflict,
  clearAuthCookie,
  emailSchema,
  fieldError,
  hasUnfinishedGame,
  loadSessionUser,
  passwordSchema,
  usernameSchema,
  type SessionUser,
} from "./auth.js";
import { hashPassword } from "./passwords.js";

type AdminOptions = {
  sql: postgres.Sql | null;
  sessionSecret: string;
  secureCookies: boolean;
};

type AccountRow = {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  disabled: boolean;
  created_at: Date | string;
};

const createSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  gdprAccepted: z.literal(true, {
    errorMap: () => ({ message: "Accept the privacy notice to create an account." }),
  }),
});

const disableSchema = z.object({
  disabled: z.boolean(),
});

const passwordResetSchema = z.object({
  password: passwordSchema,
});

const idSchema = z.string().uuid();

function accountJson(row: AccountRow) {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    isAdmin: row.is_admin,
    disabled: row.disabled,
    createdAt,
  };
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminOptions): void {
  const { sql, sessionSecret, secureCookies } = options;

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
    if (!sql) {
      await reply.code(503).send({ error: "Database is not connected." });
      return null;
    }
    const user = await loadSessionUser(sql, request, sessionSecret);
    if (!user) {
      clearAuthCookie(reply, secureCookies);
      await reply.code(401).send({ error: "Log in as an administrator." });
      return null;
    }
    if (!user.is_admin) {
      await reply.code(403).send({ error: "This page is for administrators." });
      return null;
    }
    return user;
  }

  function accountId(request: FastifyRequest, reply: FastifyReply): string | null {
    const parsed = idSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) {
      reply.code(400).send({ error: "Unknown account." });
      return null;
    }
    return parsed.data;
  }

  app.get("/api/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin || !sql) {
      return;
    }
    const rows = await sql<AccountRow[]>`
      select id, username, email, is_admin, disabled, created_at
      from users
      order by created_at asc, username asc
    `;
    return { users: rows.map(accountJson) };
  });

  app.post("/api/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin || !sql) {
      return;
    }
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    const { username, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      const rows = await sql<AccountRow[]>`
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
          false
        )
        returning id, username, email, is_admin, disabled, created_at
      `;
      const user = rows[0];
      if (!user) {
        return reply.code(500).send({ error: "Something went wrong." });
      }
      return reply.code(201).send({ user: accountJson(user) });
    } catch (error) {
      const conflict = accountConflict(error);
      if (conflict) {
        return reply.code(409).send(conflict);
      }
      throw error;
    }
  });

  app.patch("/api/admin/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin || !sql) {
      return;
    }
    const id = accountId(request, reply);
    if (!id) {
      return;
    }
    const parsed = disableSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    if (id === admin.id && parsed.data.disabled) {
      return reply.code(409).send({ error: "You cannot disable your own account." });
    }
    const rows = await sql.begin(async (tx) => {
      const updated = await tx<AccountRow[]>`
        update users
        set disabled = ${parsed.data.disabled}
        where id = ${id}::uuid
        returning id, username, email, is_admin, disabled, created_at
      `;
      if (updated[0] && parsed.data.disabled) {
        await tx`delete from sessions where user_id = ${id}::uuid`;
      }
      return updated;
    });
    const user = rows[0];
    if (!user) {
      return reply.code(404).send({ error: "That account does not exist." });
    }
    return { user: accountJson(user) };
  });

  app.post("/api/admin/users/:id/password", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin || !sql) {
      return;
    }
    const id = accountId(request, reply);
    if (!id) {
      return;
    }
    const parsed = passwordResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const rows = await sql.begin(async (tx) => {
      const updated = await tx<{ id: string }[]>`
        update users
        set password_hash = ${passwordHash}
        where id = ${id}::uuid
        returning id
      `;
      if (updated[0]) {
        await tx`delete from sessions where user_id = ${id}::uuid`;
      }
      return updated;
    });
    if (!rows[0]) {
      return reply.code(404).send({ error: "That account does not exist." });
    }
    return { ok: true };
  });

  app.delete("/api/admin/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin || !sql) {
      return;
    }
    const id = accountId(request, reply);
    if (!id) {
      return;
    }
    if (id === admin.id) {
      return reply.code(409).send({ error: "You cannot delete your own account from this page." });
    }
    if (await hasUnfinishedGame(sql, id)) {
      return reply.code(409).send({
        error: "This account is in a game that has not finished. Deletion waits until that game is over.",
      });
    }
    const rows = await sql<{ id: string }[]>`
      delete from users where id = ${id}::uuid returning id
    `;
    if (!rows[0]) {
      return reply.code(404).send({ error: "That account does not exist." });
    }
    return { ok: true };
  });
}
