import type postgres from "postgres";

export async function migrate(sql: postgres.Sql): Promise<void> {
  await sql`
    create table if not exists users (
      id uuid primary key,
      username text not null,
      username_normalized text not null unique,
      email text not null unique,
      password_hash text not null,
      gdpr_accepted_at timestamptz not null,
      is_admin boolean not null default false,
      disabled boolean not null default false,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists sessions (
      id uuid primary key,
      user_id uuid not null references users (id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists games (
      id uuid primary key,
      status text not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists game_players (
      game_id uuid not null references games (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      primary key (game_id, user_id)
    )
  `;
  await sql`alter table games add column if not exists name text`;
  await sql`alter table games add column if not exists name_normalized text`;
  await sql`alter table games add column if not exists password_hash text`;
  await sql`alter table games add column if not exists human_seats smallint`;
  await sql`alter table games add column if not exists ai_seats smallint`;
  await sql`alter table games add column if not exists created_by uuid references users (id) on delete set null`;
  await sql`alter table games add column if not exists state jsonb not null default '{}'::jsonb`;
  await sql`alter table games add column if not exists ai_next_move_at timestamptz`;
  await sql`create index if not exists games_due_ai on games (ai_next_move_at) where status = 'playing' and ai_next_move_at is not null`;
  await sql`alter table game_players add column if not exists seat_index smallint`;
  // PostgreSQL delivers these only after commit, across all server instances.
  await sql`
    create or replace function notify_game_changed() returns trigger as $$
    begin
      if TG_OP = 'DELETE' then
        perform pg_notify('game_changed', OLD.id::text);
        return OLD;
      end if;
      perform pg_notify('game_changed', NEW.id::text);
      return NEW;
    end;
    $$ language plpgsql
  `;
  await sql`
    do $$ begin
      if not exists (select 1 from pg_trigger where tgname = 'games_notify_changed' and tgrelid = 'games'::regclass) then
        create trigger games_notify_changed after insert or update or delete on games
          for each row execute function notify_game_changed();
      end if;
    end $$
  `;
  await sql`
    create unique index if not exists games_active_name
    on games (name_normalized)
    where status in ('waiting', 'playing')
  `;
  await sql`
    create unique index if not exists game_players_seat
    on game_players (game_id, seat_index)
  `;
}
