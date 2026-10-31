import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create table mcp_oauth_settings (
      workspace_id uuid primary key references workspaces(id) on delete cascade,
      enabled boolean not null default false,
      updated_at timestamptz not null default now()
    );
    create table mcp_oauth_clients (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      name varchar(120) not null,
      redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array'),
      created_at timestamptz not null default now()
    );
    create index mcp_oauth_clients_workspace_idx on mcp_oauth_clients(workspace_id);
    create table mcp_oauth_authorizations (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      client_id uuid not null references mcp_oauth_clients(id) on delete cascade,
      redirect_uri text not null,
      resource text not null,
      state text,
      challenge varchar(43) not null,
      expires_at timestamptz not null,
      decided_at timestamptz,
      code_hash varchar(64) unique,
      code_expires_at timestamptz,
      code_used_at timestamptz,
      created_at timestamptz not null default now()
    );
    create index mcp_oauth_authorizations_expiry_idx on mcp_oauth_authorizations(expires_at);
    create table mcp_oauth_grants (
      id uuid primary key,
      authorization_id uuid not null unique references mcp_oauth_authorizations(id) on delete cascade,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      client_id uuid not null references mcp_oauth_clients(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      space_id uuid not null references spaces(id) on delete cascade,
      space_name text not null,
      session_id uuid not null references user_sessions(id) on delete cascade,
      resource text not null,
      capabilities jsonb not null check (jsonb_typeof(capabilities) = 'array'),
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      revoked_at timestamptz,
      last_used_at timestamptz
    );
    create index mcp_oauth_grants_user_idx on mcp_oauth_grants(workspace_id, user_id);
    create table mcp_oauth_tokens (
      hash varchar(64) primary key,
      grant_id uuid not null references mcp_oauth_grants(id) on delete cascade,
      kind varchar(7) not null check (kind in ('access', 'refresh')),
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create index mcp_oauth_tokens_grant_idx on mcp_oauth_tokens(grant_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  const used = await sql`select 1 from mcp_oauth_grants limit 1`.execute(db);
  if (used.rows.length)
    throw new Error(
      'MCP OAuth grants exist; disable OAuth instead of downgrading',
    );
  await sql`drop table mcp_oauth_tokens, mcp_oauth_grants, mcp_oauth_authorizations, mcp_oauth_clients, mcp_oauth_settings`.execute(
    db,
  );
}
