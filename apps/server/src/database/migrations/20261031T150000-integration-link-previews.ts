import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`create table integration_preview_settings (
    workspace_id uuid primary key references workspaces(id) on delete cascade,
    enabled boolean not null default false,
    updated_at timestamptz not null default now()
  );
  create table integration_preview_connections (
    id uuid primary key,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    provider varchar(6) not null check (provider in ('github', 'gitlab', 'figma')),
    credential text not null,
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_used_at timestamptz,
    unique(workspace_id, user_id, provider)
  )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  const used = await sql`select 1 from integration_preview_connections limit 1`.execute(db);
  if (used.rows.length) throw new Error('Integration credentials exist; disable link previews instead of downgrading');
  await sql`drop table integration_preview_connections, integration_preview_settings`.execute(db);
}
