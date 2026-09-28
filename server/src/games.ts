import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type postgres from "postgres";
import { z } from "zod";
import { clearAuthCookie, fieldError, loadSessionUser, type SessionUser } from "./auth.js";
import { hashPassword, verifyPassword } from "./passwords.js";

type GameOptions = {
  sql: postgres.Sql | null;
  sessionSecret: string;
  secureCookies: boolean;
};

type GameRow = {
  id: string;
  name: string;
  status: string;
  human_seats: number;
  ai_seats: number;
  created_by: string | null;
  creator: string | null;
  password_hash: string | null;
};

type PlayerRow = {
  game_id: string;
  user_id: string;
  seat_index: number;
  username: string;
};

type StoredSeat = {
  seat: number;
  kind: "human" | "ai";
  userId: string | null;
  username: string | null;
};

const nameSchema = z
  .string()
  .trim()
  .min(3, "Name the game with at least 3 characters.")
  .max(40, "The game name must be at most 40 characters.")
  .regex(
    /^[\p{L}\p{N}]+(?:[ '\-][\p{L}\p{N}]+)*$/u,
    "Use letters, numbers, spaces, apostrophes, or hyphens.",
  );

const gamePasswordSchema = z
  .string()
  .min(4, "The game password must be at least 4 characters.")
  .max(64, "The game password must be at most 64 characters.");

const createSchema = z
  .object({
    name: nameSchema,
    password: gamePasswordSchema,
    humanSeats: z.number().int().min(1, "At least one person plays.").max(6),
    aiSeats: z.number().int().min(0).max(5),
  })
  .superRefine((value, context) => {
    if (value.humanSeats + value.aiSeats > 6) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A game seats at most 6 players.",
        path: ["humanSeats"],
      });
    }
  });

const passwordSchema = z.object({
  password: gamePasswordSchema,
});

const idSchema = z.string().uuid();

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}

function publicSeats(game: Pick<GameRow, "human_seats" | "ai_seats">, players: PlayerRow[], userId: string) {
  const bySeat = new Map(players.map((player) => [player.seat_index, player]));
  const seats: Array<{ seat: number; kind: "human" | "ai"; username: string | null; you: boolean }> = [];
  for (let seat = 0; seat < game.human_seats; seat += 1) {
    const player = bySeat.get(seat);
    seats.push({
      seat,
      kind: "human",
      username: player?.username ?? null,
      you: player?.user_id === userId,
    });
  }
  for (let index = 0; index < game.ai_seats; index += 1) {
    seats.push({
      seat: game.human_seats + index,
      kind: "ai",
      username: `AI ${index + 1}`,
      you: false,
    });
  }
  return seats;
}

function storedState(game: Pick<GameRow, "human_seats" | "ai_seats" | "status">, players: PlayerRow[]) {
  const bySeat = new Map(players.map((player) => [player.seat_index, player]));
  const seats: StoredSeat[] = [];
  for (let seat = 0; seat < game.human_seats; seat += 1) {
    const player = bySeat.get(seat);
    seats.push({
      seat,
      kind: "human",
      userId: player?.user_id ?? null,
      username: player?.username ?? null,
    });
  }
  for (let index = 0; index < game.ai_seats; index += 1) {
    seats.push({
      seat: game.human_seats + index,
      kind: "ai",
      userId: null,
      username: `AI ${index + 1}`,
    });
  }
  return { phase: game.status, seats };
}

function summarize(game: GameRow, players: PlayerRow[], userId: string) {
  const seats = publicSeats(game, players, userId);
  const yours = seats.find((seat) => seat.you);
  return {
    id: game.id,
    name: game.name,
    status: game.status,
    humanSeats: game.human_seats,
    aiSeats: game.ai_seats,
    seatedHumans: players.length,
    yourSeat: yours ? yours.seat : null,
    creator: game.creator,
    createdByYou: game.created_by === userId,
    seats,
  };
}

export function registerGameRoutes(app: FastifyInstance, options: GameOptions): void {
  const { sql, sessionSecret, secureCookies } = options;

  async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
    if (!sql) {
      await reply.code(503).send({ error: "Database is not connected." });
      return null;
    }
    const user = await loadSessionUser(sql, request, sessionSecret);
    if (!user) {
      clearAuthCookie(reply, secureCookies);
      await reply.code(401).send({ error: "Log in to enter the lobby." });
      return null;
    }
    return user;
  }

  async function loadPlayers(query: postgres.TransactionSql, gameId: string): Promise<PlayerRow[]> {
    return query<PlayerRow[]>`
      select gp.game_id, gp.user_id, gp.seat_index, u.username
      from game_players gp
      join users u on u.id = gp.user_id
      where gp.game_id = ${gameId}::uuid
      order by gp.seat_index asc
    `;
  }

  async function saveState(query: postgres.TransactionSql, game: GameRow, players: PlayerRow[]): Promise<void> {
    await query`
      update games
      set state = ${query.json(storedState(game, players))}
      where id = ${game.id}::uuid
    `;
  }

  app.get("/api/games", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const rows = await sql<Array<GameRow & PlayerRow & { player_game_id: string | null }>>`
      select
        g.id,
        g.name,
        g.status,
        g.human_seats,
        g.ai_seats,
        g.created_by,
        creator.username as creator,
        gp.game_id as player_game_id,
        gp.user_id,
        gp.seat_index,
        player.username
      from games g
      left join users creator on creator.id = g.created_by
      left join game_players gp on gp.game_id = g.id
      left join users player on player.id = gp.user_id
      where g.status in ('waiting', 'playing')
        and g.name is not null
      order by g.created_at desc, gp.seat_index asc
    `;
    const grouped = new Map<string, { game: GameRow; players: PlayerRow[] }>();
    for (const row of rows) {
      let entry = grouped.get(row.id);
      if (!entry) {
        entry = {
          game: {
            id: row.id,
            name: row.name,
            status: row.status,
            human_seats: row.human_seats,
            ai_seats: row.ai_seats,
            created_by: row.created_by,
            creator: row.creator,
            password_hash: null,
          },
          players: [],
        };
        grouped.set(row.id, entry);
      }
      if (row.player_game_id && row.user_id) {
        entry.players.push({
          game_id: row.id,
          user_id: row.user_id,
          seat_index: row.seat_index,
          username: row.username,
        });
      }
    }
    const games = [...grouped.values()].map((entry) => summarize(entry.game, entry.players, user.id));
    return {
      yours: games.filter((game) => game.yourSeat !== null),
      open: games.filter((game) => game.status === "waiting" && game.yourSeat === null),
    };
  });

  app.post("/api/games", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    const { name, password, humanSeats, aiSeats } = parsed.data;
    const status = humanSeats === 1 ? "playing" : "waiting";
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    try {
      const game = await sql.begin(async (tx) => {
        const inserted = await tx<GameRow[]>`
          insert into games (
            id, status, name, name_normalized, password_hash, human_seats, ai_seats, created_by
          )
          values (
            ${id}::uuid,
            ${status},
            ${name},
            ${name.toLowerCase()},
            ${passwordHash},
            ${humanSeats},
            ${aiSeats},
            ${user.id}::uuid
          )
          returning id, name, status, human_seats, ai_seats, created_by
        `;
        const created = inserted[0];
        if (!created) {
          throw new Error("Game insert returned no row.");
        }
        created.creator = user.username;
        created.password_hash = null;
        await tx`
          insert into game_players (game_id, user_id, seat_index)
          values (${created.id}::uuid, ${user.id}::uuid, 0)
        `;
        const players = await loadPlayers(tx, created.id);
        await saveState(tx, created, players);
        return summarize(created, players, user.id);
      });
      return reply.code(201).send({ game });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: "A game with that name is already open.", field: "name" });
      }
      throw error;
    }
  });

  app.post("/api/games/:id/join", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) {
      return reply.code(400).send({ error: "That game does not exist." });
    }
    const parsed = passwordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(fieldError(parsed.error));
    }
    const outcome = await sql.begin(async (tx) => {
      const rows = await tx<GameRow[]>`
        select g.id, g.name, g.status, g.human_seats, g.ai_seats, g.created_by, u.username as creator, g.password_hash
        from games g
        left join users u on u.id = g.created_by
        where g.id = ${id.data}::uuid
        for update of g
      `;
      const game = rows[0];
      if (!game?.name || !game.password_hash) {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      const passwordMatches = await verifyPassword(parsed.data.password, game.password_hash);
      if (!passwordMatches) {
        return { status: 401, body: { error: "Password is incorrect.", field: "password" } };
      }
      if (game.status === "cancelled" || game.status === "finished") {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      let players = await loadPlayers(tx, game.id);
      const already = players.some((player) => player.user_id === user.id);
      if (already) {
        return { status: 200, body: { game: summarize(game, players, user.id) } };
      }
      if (game.status !== "waiting") {
        return { status: 403, body: { error: "This game has already started." } };
      }
      const openSeat = Array.from({ length: game.human_seats }, (_, seat) => seat).find(
        (seat) => !players.some((player) => player.seat_index === seat),
      );
      if (openSeat === undefined) {
        return { status: 409, body: { error: "This game is full." } };
      }
      await tx`
        insert into game_players (game_id, user_id, seat_index)
        values (${game.id}::uuid, ${user.id}::uuid, ${openSeat})
      `;
      players = await loadPlayers(tx, game.id);
      const started = players.length === game.human_seats;
      if (started) {
        game.status = "playing";
        await tx`update games set status = 'playing' where id = ${game.id}::uuid`;
      }
      await saveState(tx, game, players);
      return { status: started ? 201 : 200, body: { game: summarize(game, players, user.id) } };
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  app.post("/api/games/:id/leave", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) {
      return reply.code(400).send({ error: "That game does not exist." });
    }
    const outcome = await sql.begin(async (tx) => {
      const rows = await tx<GameRow[]>`
        select g.id, g.name, g.status, g.human_seats, g.ai_seats, g.created_by, u.username as creator, g.password_hash
        from games g
        left join users u on u.id = g.created_by
        where g.id = ${id.data}::uuid
        for update of g
      `;
      const game = rows[0];
      if (!game?.name) {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      if (game.created_by === user.id) {
        return { status: 409, body: { error: "Cancel the game to close it." } };
      }
      if (game.status !== "waiting") {
        return { status: 409, body: { error: "The roster is fixed once the game starts." } };
      }
      const removed = await tx<{ user_id: string }[]>`
        delete from game_players
        where game_id = ${game.id}::uuid and user_id = ${user.id}::uuid
        returning user_id
      `;
      if (!removed[0]) {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      const players = await loadPlayers(tx, game.id);
      await saveState(tx, game, players);
      return { status: 200, body: { ok: true } };
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  app.post("/api/games/:id/cancel", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) {
      return reply.code(400).send({ error: "That game does not exist." });
    }
    const outcome = await sql.begin(async (tx) => {
      const rows = await tx<GameRow[]>`
        select g.id, g.name, g.status, g.human_seats, g.ai_seats, g.created_by, u.username as creator, g.password_hash
        from games g
        left join users u on u.id = g.created_by
        where g.id = ${id.data}::uuid
        for update of g
      `;
      const game = rows[0];
      if (!game?.name) {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      if (game.created_by !== user.id) {
        return { status: 403, body: { error: "Only the person who created this game can cancel it." } };
      }
      if (game.status !== "waiting") {
        return { status: 409, body: { error: "This game has already started." } };
      }
      game.status = "cancelled";
      await tx`update games set status = 'cancelled' where id = ${game.id}::uuid`;
      const players = await loadPlayers(tx, game.id);
      await saveState(tx, game, players);
      return { status: 200, body: { ok: true } };
    });
    return reply.code(outcome.status).send(outcome.body);
  });
}
