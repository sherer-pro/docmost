import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_assistant_profile_workspace_settings')
    .addColumn('workspace_id', 'uuid', (col) =>
      col.primaryKey().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('model_overrides_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
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
      'ai_assistant_profile_workspace_policy_version_check',
      sql`"policy_version" >= 1`,
    )
    .execute();

  await db.schema
    .createTable('ai_assistant_profiles')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'varchar')
    .addColumn('icon', 'varchar', (col) => col.notNull())
    .addColumn('instructions', 'text', (col) => col.notNull())
    .addColumn('quick_commands', 'jsonb')
    .addColumn('chat_model_override', 'varchar')
    .addColumn('temperature_override', 'double precision')
    .addColumn('max_output_tokens_override', 'integer')
    .addColumn('allowed_builtin_capabilities', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('auto_start', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('launch_message', 'text')
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
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
    .addCheckConstraint(
      'ai_assistant_profiles_name_check',
      sql`length("name") between 1 and 80`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_description_check',
      sql`"description" is null or length("description") <= 500`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_instructions_check',
      sql`length("instructions") between 1 and 20000`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_launch_message_check',
      sql`("launch_message" is null or length("launch_message") <= 2000) and (("auto_start" = false) or ("launch_message" is not null and length("launch_message") between 1 and 2000))`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_model_check',
      sql`"chat_model_override" is null or length("chat_model_override") between 1 and 200`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_temperature_check',
      sql`"temperature_override" is null or "temperature_override" between 0 and 2`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_max_output_check',
      sql`"max_output_tokens_override" is null or "max_output_tokens_override" >= 1`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_capabilities_check',
      sql`jsonb_typeof("allowed_builtin_capabilities") = 'array'`,
    )
    .addCheckConstraint(
      'ai_assistant_profiles_version_check',
      sql`"version" >= 1`,
    )
    .execute();

  await sql`
    create unique index ai_assistant_profiles_active_name_unique
    on ai_assistant_profiles (space_id, lower(name))
    where deleted_at is null
  `.execute(db);
  await db.schema
    .createIndex('idx_ai_assistant_profiles_space_active')
    .on('ai_assistant_profiles')
    .columns(['workspace_id', 'space_id', 'enabled', 'deleted_at'])
    .execute();

  await db.schema
    .createTable('ai_assistant_profile_mcp_tools')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('profile_id', 'uuid', (col) =>
      col.references('ai_assistant_profiles.id').onDelete('cascade').notNull(),
    )
    .addColumn('binding_id', 'uuid', (col) =>
      col.references('ai_mcp_space_bindings.id').onDelete('cascade').notNull(),
    )
    .addColumn('tool_name', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_assistant_profile_mcp_tools_unique', [
      'profile_id',
      'binding_id',
      'tool_name',
    ])
    .addCheckConstraint(
      'ai_assistant_profile_mcp_tools_name_check',
      sql`length("tool_name") between 1 and 64`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_assistant_profile_mcp_tools_binding')
    .on('ai_assistant_profile_mcp_tools')
    .column('binding_id')
    .execute();

  await db.schema
    .createTable('ai_assistant_profile_group_policies')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('profile_id', 'uuid', (col) =>
      col.references('ai_assistant_profiles.id').onDelete('cascade').notNull(),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade').notNull(),
    )
    .addColumn('available', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('allowed_builtin_capabilities', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('ai_assistant_profile_group_policies_unique', [
      'profile_id',
      'group_id',
    ])
    .addCheckConstraint(
      'ai_assistant_profile_group_capabilities_check',
      sql`"allowed_builtin_capabilities" is null or jsonb_typeof("allowed_builtin_capabilities") = 'array'`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_assistant_profile_group_policies_group')
    .on('ai_assistant_profile_group_policies')
    .column('group_id')
    .execute();

  await db.schema
    .createTable('ai_assistant_profile_user_preferences')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('preferred_profile_id', 'uuid', (col) =>
      col.references('ai_assistant_profiles.id').onDelete('set null'),
    )
    .addColumn('hidden_profile_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_assistant_profile_user_preferences_unique', [
      'space_id',
      'user_id',
    ])
    .execute();

  await db.schema
    .createTable('ai_agent_tool_verifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('profile_id', 'uuid', (col) =>
      col.references('ai_assistant_profiles.id').onDelete('cascade').notNull(),
    )
    .addColumn('profile_version', 'integer', (col) => col.notNull())
    .addColumn('provider_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('tool_schema_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('tool_policy_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('verification_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('probe_tool_name', 'varchar', (col) => col.notNull())
    .addColumn('tested_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('tested_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('ai_agent_tool_verifications_unique', [
      'profile_id',
      'verification_fingerprint',
    ])
    .addCheckConstraint(
      'ai_agent_tool_verifications_profile_version_check',
      sql`"profile_version" >= 1`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_agent_tool_verifications_space')
    .on('ai_agent_tool_verifications')
    .columns(['workspace_id', 'space_id', 'profile_id'])
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('default_assistant_profile_id', 'uuid', (col) =>
      col.references('ai_assistant_profiles.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .addColumn('assistant_profile_id', 'uuid', (col) =>
      col.references('ai_assistant_profiles.id').onDelete('set null'),
    )
    .addColumn('assistant_profile_version', 'integer')
    .addColumn('assistant_profile_snapshot', 'jsonb')
    .addColumn('assistant_profile_fingerprint', 'varchar')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .addCheckConstraint(
      'ai_conversations_assistant_profile_snapshot_check',
      sql`("assistant_profile_snapshot" is null and "assistant_profile_fingerprint" is null) or ("assistant_profile_snapshot" is not null and "assistant_profile_fingerprint" is not null)`,
    )
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .addCheckConstraint(
      'ai_conversations_assistant_profile_version_check',
      sql`"assistant_profile_id" is null or ("assistant_profile_version" is not null and "assistant_profile_version" >= 1)`,
    )
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addColumn('assistant_profile_snapshot', 'jsonb')
    .addColumn('assistant_profile_fingerprint', 'varchar')
    .addColumn('provider_config_snapshot', 'jsonb')
    .addColumn('provider_config_fingerprint', 'varchar')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_assistant_profile_snapshot_check',
      sql`("assistant_profile_snapshot" is null and "assistant_profile_fingerprint" is null) or ("assistant_profile_snapshot" is not null and "assistant_profile_fingerprint" is not null)`,
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_provider_config_snapshot_check',
      sql`("provider_config_snapshot" is null and "provider_config_fingerprint" is null) or ("provider_config_snapshot" is not null and "provider_config_fingerprint" is not null)`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // This rollback deletes immutable profile and verification history. Production
  // rollback must use AI_ASSISTANT_PROFILES_ENABLED instead of running down.
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_provider_config_snapshot_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_assistant_profile_snapshot_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('provider_config_fingerprint')
    .dropColumn('provider_config_snapshot')
    .dropColumn('assistant_profile_fingerprint')
    .dropColumn('assistant_profile_snapshot')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropConstraint('ai_conversations_assistant_profile_version_check')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropConstraint('ai_conversations_assistant_profile_snapshot_check')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropColumn('assistant_profile_fingerprint')
    .dropColumn('assistant_profile_snapshot')
    .dropColumn('assistant_profile_version')
    .dropColumn('assistant_profile_id')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('default_assistant_profile_id')
    .execute();
  await db.schema.dropTable('ai_agent_tool_verifications').execute();
  await db.schema
    .dropTable('ai_assistant_profile_user_preferences')
    .execute();
  await db.schema
    .dropTable('ai_assistant_profile_group_policies')
    .execute();
  await db.schema.dropTable('ai_assistant_profile_mcp_tools').execute();
  await db.schema.dropTable('ai_assistant_profiles').execute();
  await db.schema
    .dropTable('ai_assistant_profile_workspace_settings')
    .execute();
}
