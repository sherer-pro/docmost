import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('agent_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('agent_verified_provider_fingerprint', 'varchar')
    .addColumn('agent_verified_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .addColumn('agent_mode', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();

  await db.schema
    .dropIndex('uniq_ai_runs_active_conversation')
    .ifExists()
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_status_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addColumn('execution_mode', 'varchar', (col) =>
      col.notNull().defaultTo('chat'),
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_execution_mode_check',
      sql`"execution_mode" in ('chat', 'agent')`,
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_status_check',
      sql`"status" in ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')`,
    )
    .execute();
  await db.schema
    .createIndex('uniq_ai_runs_active_conversation')
    .on('ai_runs')
    .column('conversation_id')
    .unique()
    .where(sql<boolean>`"status" in ('queued', 'running', 'awaiting_approval')`)
    .execute();

  await db.schema
    .createTable('ai_run_steps')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.references('ai_runs.id').onDelete('cascade').notNull(),
    )
    .addColumn('sequence', 'integer', (col) => col.notNull())
    .addColumn('model_step', 'integer', (col) => col.notNull())
    .addColumn('call_index', 'integer', (col) => col.notNull())
    .addColumn('tool_call_id', 'varchar', (col) => col.notNull())
    .addColumn('tool_name', 'varchar', (col) => col.notNull())
    .addColumn('write_class', 'varchar', (col) => col.notNull())
    .addColumn('arguments', 'jsonb', (col) => col.notNull())
    .addColumn('result', 'jsonb')
    .addColumn('assistant_content', 'text')
    .addColumn('status', 'varchar', (col) => col.notNull())
    .addColumn('error_code', 'varchar')
    .addColumn('error_message', 'text')
    .addColumn('target_page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('set null'),
    )
    .addColumn('base_content_hash', 'varchar')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('decided_at', 'timestamptz')
    .addColumn('decided_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_run_steps_run_sequence_unique', [
      'run_id',
      'sequence',
    ])
    .addUniqueConstraint('ai_run_steps_run_tool_call_unique', [
      'run_id',
      'tool_call_id',
    ])
    .addCheckConstraint(
      'ai_run_steps_position_check',
      sql`"sequence" >= 0 and "model_step" >= 0 and "call_index" >= 0`,
    )
    .addCheckConstraint(
      'ai_run_steps_write_class_check',
      sql`"write_class" in ('read_only', 'write')`,
    )
    .addCheckConstraint(
      'ai_run_steps_status_check',
      sql`"status" in ('completed', 'pending_approval', 'approved', 'rejected', 'failed', 'expired')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_run_steps_run_position')
    .on('ai_run_steps')
    .columns(['run_id', 'model_step', 'call_index'])
    .execute();
  await db.schema
    .createIndex('idx_ai_run_steps_pending_expiry')
    .on('ai_run_steps')
    .columns(['status', 'expires_at'])
    .where('status', '=', 'pending_approval')
    .execute();

  await db.schema
    .alterTable('api_keys')
    .addColumn('key_type', 'varchar', (col) =>
      col.notNull().defaultTo('rag'),
    )
    .execute();
  await db.schema
    .alterTable('api_keys')
    .addCheckConstraint(
      'api_keys_key_type_check',
      sql`"key_type" in ('rag', 'mcp')`,
    )
    .execute();
  await db.schema
    .createIndex('idx_api_keys_workspace_type_deleted')
    .on('api_keys')
    .columns(['workspace_id', 'key_type', 'deleted_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_api_keys_workspace_type_deleted')
    .ifExists()
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_key_type_check')
    .execute();
  await db.schema.alterTable('api_keys').dropColumn('key_type').execute();

  await db.schema.dropTable('ai_run_steps').execute();

  await db.schema
    .dropIndex('uniq_ai_runs_active_conversation')
    .ifExists()
    .execute();
  await sql`
    update ai_runs
    set status = 'cancelled',
        completed_at = coalesce(completed_at, now()),
        error_code = coalesce(error_code, 'migration_rollback')
    where status = 'awaiting_approval'
  `.execute(db);
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_status_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_execution_mode_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('execution_mode')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_status_check',
      sql`"status" in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    )
    .execute();
  await db.schema
    .createIndex('uniq_ai_runs_active_conversation')
    .on('ai_runs')
    .column('conversation_id')
    .unique()
    .where(sql<boolean>`"status" in ('queued', 'running')`)
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .dropColumn('agent_mode')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('agent_verified_at')
    .dropColumn('agent_verified_provider_fingerprint')
    .dropColumn('agent_enabled')
    .execute();
}
