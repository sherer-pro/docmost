import { Kysely, sql } from 'kysely';

const LEGACY_AGENT_CAPABILITIES = [
  'search.query',
  'page.tree.read',
  'page.context.read',
  'page.content.read',
  'page.outline.read',
  'page.node.read',
  'page.text.search',
  'page.text.propose',
  'page.node.patch.propose',
  'page.node.insert.propose',
  'page.node.delete.propose',
];

const LEGACY_MCP_CAPABILITIES = LEGACY_AGENT_CAPABILITIES.slice(0, 7);

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_builtin_tool_workspace_policies')
    .addColumn('workspace_id', 'uuid', (col) =>
      col.primaryKey().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('allowed_capabilities', 'jsonb', (col) => col.notNull())
    .addColumn('policy_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addCheckConstraint(
      'ai_builtin_tool_workspace_policy_capabilities_check',
      sql`jsonb_typeof("allowed_capabilities") = 'array'`,
    )
    .addCheckConstraint(
      'ai_builtin_tool_workspace_policy_version_check',
      sql`"policy_version" >= 1`,
    )
    .execute();

  await db.schema
    .createTable('ai_builtin_tool_space_policies')
    .addColumn('space_id', 'uuid', (col) =>
      col.primaryKey().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('allowed_capabilities', 'jsonb')
    .addColumn('policy_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addCheckConstraint(
      'ai_builtin_tool_space_policy_capabilities_check',
      sql`"allowed_capabilities" is null or jsonb_typeof("allowed_capabilities") = 'array'`,
    )
    .addCheckConstraint(
      'ai_builtin_tool_space_policy_version_check',
      sql`"policy_version" >= 1`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_builtin_tool_space_policy_workspace')
    .on('ai_builtin_tool_space_policies')
    .column('workspace_id')
    .execute();

  await db.schema
    .alterTable('api_keys')
    .addColumn('allowed_capabilities', 'jsonb')
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addColumn('builtin_tool_policy_snapshot', 'jsonb')
    .addColumn('builtin_tool_policy_fingerprint', 'varchar')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_builtin_tool_snapshot_check',
      sql`"builtin_tool_policy_snapshot" is null or "builtin_tool_policy_fingerprint" is not null`,
    )
    .execute();

  await sql`
    insert into ai_builtin_tool_workspace_policies (
      workspace_id,
      enabled,
      allowed_capabilities
    )
    select id, true, ${JSON.stringify(LEGACY_AGENT_CAPABILITIES)}::jsonb
    from workspaces
    on conflict (workspace_id) do nothing
  `.execute(db);

  await sql`
    update api_keys
    set allowed_capabilities = ${JSON.stringify(LEGACY_MCP_CAPABILITIES)}::jsonb
    where key_type = 'mcp' and allowed_capabilities is null
  `.execute(db);

  await db.schema
    .alterTable('api_keys')
    .addCheckConstraint(
      'api_keys_allowed_capabilities_check',
      sql`("key_type" = 'mcp' and jsonb_typeof("allowed_capabilities") = 'array') or ("key_type" <> 'mcp' and "allowed_capabilities" is null)`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // This rollback deletes policy and run-snapshot data. Operational rollback
  // must use the policy kill switches and must not execute this migration.
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_builtin_tool_snapshot_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('builtin_tool_policy_fingerprint')
    .dropColumn('builtin_tool_policy_snapshot')
    .execute();

  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_allowed_capabilities_check')
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropColumn('allowed_capabilities')
    .execute();

  await db.schema
    .dropIndex('idx_ai_builtin_tool_space_policy_workspace')
    .ifExists()
    .execute();
  await db.schema.dropTable('ai_builtin_tool_space_policies').execute();
  await db.schema.dropTable('ai_builtin_tool_workspace_policies').execute();
}
