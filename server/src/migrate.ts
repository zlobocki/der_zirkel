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
}
