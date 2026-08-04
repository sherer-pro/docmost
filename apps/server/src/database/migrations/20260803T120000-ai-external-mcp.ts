import { Kysely, sql } from 'kysely';

/**
 * Outbound external MCP servers for the internal AI agent.
 *
 * The migration is purely additive: a missing settings row and every new
 * `enabled` flag default to disabled, so deploying this schema does not expose
 * any outbound capability on its own.
 *
 * `down` destroys the whole external MCP catalog, including the encrypted
 * request headers. Export the configuration before rolling back.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_mcp_workspace_settings')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('allowed_origins', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('policy_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('ai_mcp_workspace_settings_workspace_unique', [
      'workspace_id',
    ])
    .addCheckConstraint(
      'ai_mcp_workspace_settings_policy_version_check',
      sql`"policy_version" >= 1`,
    )
    .addCheckConstraint(
      'ai_mcp_workspace_settings_allowed_origins_check',
      sql`length("allowed_origins") <= 4096`,
    )
    .execute();

  await db.schema
    .createTable('ai_mcp_servers')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('namespace', 'varchar', (col) => col.notNull())
    .addColumn('transport', 'varchar', (col) =>
      col.notNull().defaultTo('streamable-http'),
    )
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('headers_encrypted', 'text')
    .addColumn('header_names', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('discovered_tools', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('discovery_tool_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('discovered_at', 'timestamptz')
    .addColumn('approved_tools', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('test_status', 'varchar', (col) =>
      col.notNull().defaultTo('untested'),
    )
    .addColumn('test_error_code', 'varchar')
    .addColumn('test_checked_at', 'timestamptz')
    .addColumn('config_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('ai_mcp_servers_workspace_namespace_unique', [
      'workspace_id',
      'namespace',
    ])
    .addUniqueConstraint('ai_mcp_servers_workspace_name_unique', [
      'workspace_id',
      'name',
    ])
    // Streamable HTTP is the only supported transport. The check constraint
    // makes stdio, legacy SSE, and WebSocket unrepresentable in storage.
    .addCheckConstraint(
      'ai_mcp_servers_transport_check',
      sql`"transport" = 'streamable-http'`,
    )
    .addCheckConstraint(
      'ai_mcp_servers_namespace_check',
      sql`"namespace" ~ '^[a-z][a-z0-9_]{0,23}$'`,
    )
    .addCheckConstraint(
      'ai_mcp_servers_url_check',
      sql`length("url") <= 2048 and "url" ~* '^https?://'`,
    )
    .addCheckConstraint(
      'ai_mcp_servers_test_status_check',
      sql`"test_status" in ('untested', 'passed', 'failed')`,
    )
    .addCheckConstraint(
      'ai_mcp_servers_config_version_check',
      sql`"config_version" >= 1`,
    )
    .addCheckConstraint(
      'ai_mcp_servers_discovery_tool_count_check',
      sql`"discovery_tool_count" between 0 and 128`,
    )
    .addCheckConstraint(
      'ai_mcp_servers_name_check',
      sql`length("name") between 1 and 200`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_mcp_servers_workspace_enabled')
    .on('ai_mcp_servers')
    .columns(['workspace_id', 'enabled'])
    .execute();

  await db.schema
    .createTable('ai_mcp_space_bindings')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('server_id', 'uuid', (col) =>
      col.references('ai_mcp_servers.id').onDelete('cascade').notNull(),
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('allowed_tools', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    // Keyed by agent profile. Version 1 only ever writes the `default` key, but
    // persisting the map now keeps a second profile additive.
    .addColumn('profile_allowed_tools', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('instructions', 'text')
    .addColumn('policy_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('ai_mcp_space_bindings_space_server_unique', [
      'space_id',
      'server_id',
    ])
    .addCheckConstraint(
      'ai_mcp_space_bindings_instructions_check',
      sql`"instructions" is null or length("instructions") <= 2000`,
    )
    .addCheckConstraint(
      'ai_mcp_space_bindings_policy_version_check',
      sql`"policy_version" >= 1`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_mcp_space_bindings_space_enabled')
    .on('ai_mcp_space_bindings')
    .columns(['workspace_id', 'space_id', 'enabled'])
    .execute();

  await db.schema
    .createTable('ai_mcp_group_policies')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('binding_id', 'uuid', (col) =>
      col.references('ai_mcp_space_bindings.id').onDelete('cascade').notNull(),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade').notNull(),
    )
    .addColumn('deny_connection', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    // Null means the group applies no extra narrowing. An empty array means the
    // group allows no tool at all, which is a different and deliberate state.
    .addColumn('allowed_tools', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('ai_mcp_group_policies_binding_group_unique', [
      'binding_id',
      'group_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_ai_mcp_group_policies_group')
    .on('ai_mcp_group_policies')
    .column('group_id')
    .execute();

  await db.schema
    .createTable('ai_mcp_user_preferences')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('binding_id', 'uuid', (col) =>
      col.references('ai_mcp_space_bindings.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    // Not null with a false default, so a missing row and an explicit opt-out
    // are the same answer and a partial write cannot lose the opt-out.
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_mcp_user_preferences_binding_user_unique', [
      'binding_id',
      'user_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_ai_mcp_user_preferences_user')
    .on('ai_mcp_user_preferences')
    .column('user_id')
    .execute();

  // The snapshot is a bounded capability list resolved when the run is created.
  // It never carries a server URL, request headers, or any secret.
  await db.schema
    .alterTable('ai_runs')
    .addColumn('mcp_policy_snapshot', 'jsonb')
    .addColumn('mcp_policy_fingerprint', 'varchar')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_mcp_snapshot_check',
      sql`"mcp_policy_snapshot" is null or "mcp_policy_fingerprint" is not null`,
    )
    .execute();

  await db.schema
    .alterTable('ai_run_steps')
    .addColumn('tool_source', 'varchar', (col) =>
      col.notNull().defaultTo('builtin'),
    )
    // Set null on delete keeps the audit trail after a server is removed.
    .addColumn('mcp_server_id', 'uuid', (col) =>
      col.references('ai_mcp_servers.id').onDelete('set null'),
    )
    .addColumn('mcp_tool_name', 'varchar')
    .addColumn('mcp_config_version', 'integer')
    .execute();
  await db.schema
    .alterTable('ai_run_steps')
    .addCheckConstraint(
      'ai_run_steps_tool_source_check',
      sql`"tool_source" in ('builtin', 'external_mcp')`,
    )
    .execute();
  // External MCP tools are read-only by contract. Enforcing it in the schema
  // keeps the guarantee independent of the service layer.
  await db.schema
    .alterTable('ai_run_steps')
    .addCheckConstraint(
      'ai_run_steps_external_read_only_check',
      sql`"tool_source" = 'builtin' or "write_class" = 'read_only'`,
    )
    .execute();
  await db.schema
    .createIndex('idx_ai_run_steps_mcp_server')
    .on('ai_run_steps')
    .column('mcp_server_id')
    .where('mcp_server_id', 'is not', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_ai_run_steps_mcp_server').ifExists().execute();
  await db.schema
    .alterTable('ai_run_steps')
    .dropConstraint('ai_run_steps_external_read_only_check')
    .execute();
  await db.schema
    .alterTable('ai_run_steps')
    .dropConstraint('ai_run_steps_tool_source_check')
    .execute();
  await db.schema
    .alterTable('ai_run_steps')
    .dropColumn('mcp_config_version')
    .dropColumn('mcp_tool_name')
    .dropColumn('mcp_server_id')
    .dropColumn('tool_source')
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_mcp_snapshot_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('mcp_policy_fingerprint')
    .dropColumn('mcp_policy_snapshot')
    .execute();

  await db.schema
    .dropIndex('idx_ai_mcp_user_preferences_user')
    .ifExists()
    .execute();
  await db.schema.dropTable('ai_mcp_user_preferences').execute();

  await db.schema
    .dropIndex('idx_ai_mcp_group_policies_group')
    .ifExists()
    .execute();
  await db.schema.dropTable('ai_mcp_group_policies').execute();

  await db.schema
    .dropIndex('idx_ai_mcp_space_bindings_space_enabled')
    .ifExists()
    .execute();
  await db.schema.dropTable('ai_mcp_space_bindings').execute();

  await db.schema
    .dropIndex('idx_ai_mcp_servers_workspace_enabled')
    .ifExists()
    .execute();
  await db.schema.dropTable('ai_mcp_servers').execute();

  await db.schema.dropTable('ai_mcp_workspace_settings').execute();
}
