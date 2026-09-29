import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type postgres from "postgres";
import { z } from "zod";
import { clearAuthCookie, fieldError, loadSessionUser, type SessionUser } from "./auth.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { NATION_ORDER, type NationId } from "./rules/constants.js";
import { actorSeat, availableBonds, chooseBond, openingPiles, type DraftCursor } from "./rules/draft.js";
import { describeTurn, ensurePlay, performTurn, scoreboard, type Board, type TurnCommand } from "./rules/turn.js";

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
const draftSchema = z.object({
  interest: z.number().int().min(1).max(9).nullable(),
});

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

type BoardState = Board;

const STARTING_CASH: Record<number, number> = { 1: 40, 2: 40, 3: 28, 4: 22, 5: 18, 6: 15 };

const NATIONS: Board["nations"] = [
  { id: "ah", score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: null, factories: [{ region: "LR14", kind: "land" }, { region: "LR16", kind: "land" }] },
  { id: "ita", score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: null, factories: [{ region: "LR44", kind: "land" }, { region: "LR45", kind: "sea" }] },
  { id: "fra", score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: null, factories: [{ region: "LR3", kind: "sea" }, { region: "LR7", kind: "land" }] },
  { id: "uk", score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: null, factories: [{ region: "LR36", kind: "sea" }, { region: "LR37", kind: "sea" }] },
  { id: "ger", score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: null, factories: [{ region: "LR11", kind: "sea" }, { region: "LR12", kind: "land" }] },
  { id: "rus", score: 0, tax: "tax_2-5", rondel: "Rondelcenter", rondelIndex: null, treasury: 0, government: null, factories: [{ region: "LR21", kind: "land" }, { region: "LR24", kind: "sea" }] },
];

function seatList(game: Pick<GameRow, "human_seats" | "ai_seats">, players: PlayerRow[]): StoredSeat[] {
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
  return seats;
}

function openingBoard(game: Pick<GameRow, "human_seats" | "ai_seats">, players: PlayerRow[]): Board {
  const cash = STARTING_CASH[game.human_seats + game.ai_seats] ?? 40;
  return ensurePlay({
    nations: NATIONS.map((nation) => ({ ...nation, factories: nation.factories.map((factory) => ({ ...factory })) })),
    players: seatList(game, players).map((seat) => ({
      ...seat,
      cash,
      bonds: [],
      investor: false,
      swissBank: false,
    })),
    piles: openingPiles(),
    draft: { nationIndex: 0, offerIndex: 0 },
    units: [],
    flags: [],
    nextUnit: 1,
    finished: false,
    turn: null,
  });
}

function prepareBoard(board: Board): Board {
  return ensurePlay({
    ...board,
    piles: board.piles ?? openingPiles(),
    draft: board.draft === undefined ? { nationIndex: 0, offerIndex: 0 } : board.draft,
  });
}

function boardForViewer(board: Board | null, userId: string) {
  if (!board) {
    return null;
  }
  const viewerSeat = board.players.find((player) => player.userId === userId)?.seat ?? null;
  const draft = board.draft
    ? {
        nationId: NATION_ORDER[board.draft.nationIndex] ?? "ah",
        seat: actorSeat(board.players.length, board.draft),
        yours: viewerSeat === actorSeat(board.players.length, board.draft as DraftCursor),
        choices: availableBonds(board),
      }
    : null;
  return {
    nations: board.nations,
    players: board.players.map((player) => ({
      seat: player.seat,
      kind: player.kind,
      username: player.username,
      you: player.userId === userId,
      bonds: player.bonds,
      investor: player.investor,
      swissBank: player.swissBank,
      cash: board.finished || player.userId === userId ? player.cash : null,
    })),
    units: board.units ?? [],
    flags: board.flags ?? [],
    draft,
    turn: describeTurn(board, viewerSeat),
    finished: Boolean(board.finished),
    scores: board.finished ? scoreboard(board) : null,
  };
}

function parseTurnCommand(body: unknown): TurnCommand | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const value = body as Record<string, unknown>;
  const action = value.action;
  const nation = typeof value.nationId === "string" && (NATION_ORDER as readonly string[]).includes(value.nationId) ? (value.nationId as NationId) : null;
  if (action === "rondel" && typeof value.index === "number") {
    return { action, index: value.index };
  }
  if (action === "veto" && typeof value.block === "boolean") {
    return { action, block: value.block };
  }
  if (action === "factory") {
    return { action, region: typeof value.region === "string" ? value.region : null };
  }
  if (action === "import" && (value.kind === "army" || value.kind === "fleet") && typeof value.region === "string") {
    return { action, kind: value.kind, region: value.region };
  }
  if (action === "import-done" || action === "moves-done" || action === "peace" || action === "confirm" || action === "undo" || action === "continue") {
    return { action };
  }
  if (action === "move" && typeof value.unitId === "string" && typeof value.region === "string") {
    const posture = value.posture === "hostile" || value.posture === "friendly" ? value.posture : undefined;
    return { action, unitId: value.unitId, region: value.region, posture };
  }
  if (action === "fight" && typeof value.ownId === "string" && typeof value.enemyId === "string") {
    return { action, ownId: value.ownId, enemyId: value.enemyId };
  }
  if (action === "destroy") {
    return { action, region: typeof value.region === "string" ? value.region : null };
  }
  if (action === "invest") {
    const interest = typeof value.interest === "number" ? value.interest : null;
    const replaceInterest = typeof value.replaceInterest === "number" ? value.replaceInterest : null;
    return { action, nationId: nation, interest, replaceInterest };
  }
  if (action === "treasury" && nation) {
    return { action, nationId: nation };
  }
  return null;
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
    const existing = await query<{ state: { board?: BoardState | null } }[]>`
      select state from games where id = ${game.id}::uuid
    `;
    const previous = existing[0]?.state?.board ?? null;
    const board = game.status === "playing" ? (previous ?? openingBoard(game, players)) : null;
    await query`
      update games
      set state = ${query.json({ phase: game.status, seats: seatList(game, players), board })}
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

  app.get("/api/games/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) {
      return reply.code(404).send({ error: "That game does not exist." });
    }
    const rows = await sql<Array<GameRow & { state: { board?: BoardState | null } }>>`
      select g.id, g.name, g.status, g.human_seats, g.ai_seats, g.created_by, u.username as creator, g.password_hash, g.state
      from games g
      left join users u on u.id = g.created_by
      where g.id = ${id.data}::uuid
    `;
    const game = rows[0];
    if (!game?.name || game.status === "cancelled") {
      return reply.code(404).send({ error: "That game does not exist." });
    }
    const players = await sql<PlayerRow[]>`
      select gp.game_id, gp.user_id, gp.seat_index, u.username
      from game_players gp
      join users u on u.id = gp.user_id
      where gp.game_id = ${game.id}::uuid
      order by gp.seat_index asc
    `;
    const seated = players.some((player) => player.user_id === user.id);
    if ((game.status === "playing" || game.status === "finished") && !seated) {
      return reply.code(403).send({ error: "You are not seated at this game." });
    }
    if (game.status === "finished" && !seated) {
      return reply.code(404).send({ error: "That game does not exist." });
    }
    let board = game.state?.board ?? null;
    if (game.status === "playing" && !board) {
      board = openingBoard(game, players);
    } else if (game.status === "playing" && board) {
      board = prepareBoard(board);
    }
    if (game.status === "playing" && board?.finished) {
      game.status = "finished";
      await sql`
        update games
        set status = 'finished', state = ${sql.json({ phase: "finished", seats: seatList(game, players), board })}
        where id = ${game.id}::uuid
      `;
    } else if (game.status === "playing" && board && JSON.stringify(game.state?.board ?? null) !== JSON.stringify(board)) {
      await sql`
        update games
        set state = ${sql.json({ phase: game.status, seats: seatList(game, players), board })}
        where id = ${game.id}::uuid
      `;
    }
    return { game: { ...summarize({ ...game, password_hash: null }, players, user.id), board: boardForViewer(board, user.id) } };
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

  app.post("/api/games/:id/draft", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) {
      return reply.code(404).send({ error: "That game does not exist." });
    }
    const parsed = draftSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Choose a bond or pass." });
    }
    const outcome = await sql.begin(async (tx) => {
      const rows = await tx<Array<GameRow & { state: { board?: BoardState | null; phase?: string } }>>`
        select g.id, g.name, g.status, g.human_seats, g.ai_seats, g.created_by, u.username as creator, g.password_hash, g.state
        from games g
        left join users u on u.id = g.created_by
        where g.id = ${id.data}::uuid
        for update of g
      `;
      const game = rows[0];
      if (!game?.name || game.status !== "playing") {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      const players = await loadPlayers(tx, game.id);
      if (!players.some((player) => player.user_id === user.id)) {
        return { status: 403, body: { error: "You are not seated at this game." } };
      }
      const board = prepareBoard(game.state?.board ?? openingBoard(game, players));
      const seat = board.players.find((player) => player.userId === user.id)?.seat;
      if (seat === undefined) {
        return { status: 403, body: { error: "You are not seated at this game." } };
      }
      const chosen = chooseBond(board, seat, parsed.data.interest);
      if ("error" in chosen) {
        return { status: 409, body: { error: chosen.error } };
      }
      const next = ensurePlay({ ...board, ...chosen });
      if (next.finished) {
        game.status = "finished";
      }
      await tx`
        update games
        set status = ${game.status}, state = ${tx.json({ phase: game.status, seats: seatList(game, players), board: next })}
        where id = ${game.id}::uuid
      `;
      return {
        status: 200,
        body: { game: { ...summarize({ ...game, password_hash: null }, players, user.id), board: boardForViewer(next, user.id) } },
      };
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  app.post("/api/games/:id/turn", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !sql) {
      return;
    }
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) {
      return reply.code(404).send({ error: "That game does not exist." });
    }
    const command = parseTurnCommand(request.body);
    if (!command) {
      return reply.code(400).send({ error: "That action is not available." });
    }
    const outcome = await sql.begin(async (tx) => {
      const rows = await tx<Array<GameRow & { state: { board?: Board | null } }>>`
        select g.id, g.name, g.status, g.human_seats, g.ai_seats, g.created_by, u.username as creator, g.password_hash, g.state
        from games g
        left join users u on u.id = g.created_by
        where g.id = ${id.data}::uuid
        for update of g
      `;
      const game = rows[0];
      if (!game?.name || game.status !== "playing") {
        return { status: 404, body: { error: "That game does not exist." } };
      }
      const players = await loadPlayers(tx, game.id);
      if (!players.some((player) => player.user_id === user.id)) {
        return { status: 403, body: { error: "You are not seated at this game." } };
      }
      const board = prepareBoard(game.state?.board ?? openingBoard(game, players));
      const seat = board.players.find((player) => player.userId === user.id)?.seat;
      if (seat === undefined) {
        return { status: 403, body: { error: "You are not seated at this game." } };
      }
      const played = performTurn(board, seat, command);
      if ("error" in played) {
        return { status: 409, body: { error: played.error } };
      }
      if (played.finished) {
        game.status = "finished";
      }
      await tx`
        update games
        set status = ${game.status}, state = ${tx.json({ phase: game.status, seats: seatList(game, players), board: played })}
        where id = ${game.id}::uuid
      `;
      return {
        status: 200,
        body: { game: { ...summarize({ ...game, password_hash: null }, players, user.id), board: boardForViewer(played, user.id) } },
      };
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
