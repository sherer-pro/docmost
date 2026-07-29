import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_space_configs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('provider', 'varchar', (col) =>
      col.notNull().defaultTo('openai-compatible'),
    )
    .addColumn('base_url', 'text', (col) => col.notNull())
    .addColumn('chat_model', 'varchar', (col) => col.notNull())
    .addColumn('api_key_encrypted', 'text')
    .addColumn('retrieval_adapter', 'varchar', (col) =>
      col.notNull().defaultTo('none'),
    )
    .addColumn('retrieval_url', 'text')
    .addColumn('retrieval_api_key_encrypted', 'text')
    .addColumn('retrieval_timeout_ms', 'integer', (col) =>
      col.notNull().defaultTo(8000),
    )
    .addColumn('retrieval_max_results', 'integer', (col) =>
      col.notNull().defaultTo(8),
    )
    .addColumn('system_instructions', 'text')
    .addColumn('temperature', 'double precision', (col) =>
      col.notNull().defaultTo(0.2),
    )
    .addColumn('max_output_tokens', 'integer', (col) =>
      col.notNull().defaultTo(8192),
    )
    .addColumn('context_window', 'integer', (col) =>
      col.notNull().defaultTo(131072),
    )
    .addColumn('request_timeout_ms', 'integer', (col) =>
      col.notNull().defaultTo(300000),
    )
    .addColumn('daily_request_limit_per_user', 'integer', (col) =>
      col.notNull().defaultTo(100),
    )
    .addColumn('daily_token_limit_per_space', 'bigint', (col) =>
      col.notNull().defaultTo(2000000),
    )
    .addColumn('retention_days', 'integer', (col) =>
      col.notNull().defaultTo(90),
    )
    .addColumn('vision_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('quick_commands', 'jsonb')
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_space_configs_space_unique', ['space_id'])
    .addCheckConstraint(
      'ai_space_configs_provider_check',
      sql`"provider" = 'openai-compatible'`,
    )
    .addCheckConstraint(
      'ai_space_configs_retrieval_adapter_check',
      sql`"retrieval_adapter" in ('none', 'http-json-v1')`,
    )
    .addCheckConstraint(
      'ai_space_configs_retrieval_url_check',
      sql`"retrieval_adapter" = 'none' or "retrieval_url" is not null`,
    )
    .addCheckConstraint(
      'ai_space_configs_temperature_check',
      sql`"temperature" >= 0 and "temperature" <= 2`,
    )
    .addCheckConstraint(
      'ai_space_configs_positive_limits_check',
      sql`
        "max_output_tokens" > 0
        and "context_window" > 0
        and "max_output_tokens" < "context_window"
        and "request_timeout_ms" > 0
        and "daily_request_limit_per_user" > 0
        and "daily_token_limit_per_space" > 0
        and "retrieval_timeout_ms" > 0
        and "retrieval_max_results" between 1 and 20
      `,
    )
    .addCheckConstraint(
      'ai_space_configs_retention_days_check',
      sql`"retention_days" between 1 and 365`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_space_configs_workspace')
    .on('ai_space_configs')
    .column('workspace_id')
    .execute();

  await db.schema
    .createTable('ai_conversations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('title', 'varchar')
    .addColumn('draft', 'text')
    .addColumn('use_space_search', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('last_opened_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_ai_conversations_user_page_opened')
    .on('ai_conversations')
    .columns(['user_id', 'page_id', 'last_opened_at'])
    .execute();

  await db.schema
    .createIndex('idx_ai_conversations_space_updated')
    .on('ai_conversations')
    .columns(['space_id', 'updated_at'])
    .execute();

  await db.schema
    .createTable('ai_messages')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('conversation_id', 'uuid', (col) =>
      col.references('ai_conversations.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('role', 'varchar', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('status', 'varchar', (col) =>
      col.notNull().defaultTo('completed'),
    )
    .addColumn('client_request_id', 'varchar')
    .addColumn('input_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('error_code', 'varchar')
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'ai_messages_role_check',
      sql`"role" in ('user', 'assistant', 'system')`,
    )
    .addCheckConstraint(
      'ai_messages_status_check',
      sql`"status" in ('pending', 'streaming', 'completed', 'failed', 'cancelled')`,
    )
    .addCheckConstraint(
      'ai_messages_token_counts_check',
      sql`"input_tokens" >= 0 and "output_tokens" >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_messages_conversation_created')
    .on('ai_messages')
    .columns(['conversation_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('uniq_ai_messages_conversation_client_request')
    .on('ai_messages')
    .columns(['conversation_id', 'client_request_id'])
    .unique()
    .where('client_request_id', 'is not', null)
    .execute();

  await db.schema
    .createTable('ai_runs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('conversation_id', 'uuid', (col) =>
      col.references('ai_conversations.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_message_id', 'uuid', (col) =>
      col.references('ai_messages.id').onDelete('cascade').notNull(),
    )
    .addColumn('assistant_message_id', 'uuid', (col) =>
      col.references('ai_messages.id').onDelete('cascade').notNull(),
    )
    .addColumn('status', 'varchar', (col) => col.notNull().defaultTo('queued'))
    .addColumn('client_request_id', 'varchar', (col) => col.notNull())
    .addColumn('use_space_search', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('chat_file_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('attachment_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('document_snapshot', 'text')
    .addColumn('selection_text', 'text')
    .addColumn('selection_from', 'integer')
    .addColumn('selection_to', 'integer')
    .addColumn('snapshot_hash', 'varchar')
    .addColumn('sequence', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('heartbeat_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('cancel_requested_at', 'timestamptz')
    .addColumn('error_code', 'varchar')
    .addColumn('error_message', 'text')
    .addColumn('finish_reason', 'varchar')
    .addColumn('retrieval_outcome', 'varchar', (col) =>
      col.notNull().defaultTo('not_requested'),
    )
    .addColumn('retrieval_error_code', 'varchar')
    .addColumn('input_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'ai_runs_status_check',
      sql`"status" in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    )
    .addCheckConstraint('ai_runs_sequence_check', sql`"sequence" >= 0`)
    .addCheckConstraint(
      'ai_runs_token_counts_check',
      sql`"input_tokens" >= 0 and "output_tokens" >= 0`,
    )
    .addCheckConstraint(
      'ai_runs_retrieval_outcome_check',
      sql`"retrieval_outcome" in ('not_requested', 'disabled', 'used', 'empty', 'failed')`,
    )
    .addCheckConstraint(
      'ai_runs_selection_range_check',
      sql`
        ("selection_from" is null and "selection_to" is null)
        or (
          "selection_from" is not null
          and "selection_to" is not null
          and "selection_from" >= 0
          and "selection_to" >= "selection_from"
        )
      `,
    )
    .execute();

  await db.schema
    .createIndex('uniq_ai_runs_user_conversation_request')
    .on('ai_runs')
    .columns(['user_id', 'conversation_id', 'client_request_id'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_ai_runs_status_heartbeat')
    .on('ai_runs')
    .columns(['status', 'heartbeat_at'])
    .execute();

  await db.schema
    .createIndex('uniq_ai_runs_active_conversation')
    .on('ai_runs')
    .column('conversation_id')
    .unique()
    .where(sql<boolean>`"status" in ('queued', 'running')`)
    .execute();

  await db.schema
    .createIndex('idx_ai_runs_space_created')
    .on('ai_runs')
    .columns(['space_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('ai_chat_files')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('conversation_id', 'uuid', (col) =>
      col.references('ai_conversations.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('mime_type', 'varchar', (col) => col.notNull())
    .addColumn('size', 'bigint', (col) => col.notNull())
    .addColumn('storage_key', 'text', (col) => col.notNull())
    .addColumn('status', 'varchar', (col) => col.notNull().defaultTo('pending'))
    .addColumn('extracted_text', 'text')
    .addColumn('error', 'text')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint(
      'ai_chat_files_size_check',
      sql`"size" > 0 and "size" <= 26214400`,
    )
    .addCheckConstraint(
      'ai_chat_files_status_check',
      sql`"status" in ('pending', 'processing', 'ready', 'failed')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_ai_chat_files_conversation_created')
    .on('ai_chat_files')
    .columns(['conversation_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('idx_ai_chat_files_expiry')
    .on('ai_chat_files')
    .column('expires_at')
    .where('expires_at', 'is not', null)
    .execute();

  await db.schema
    .createTable('ai_message_sources')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('message_id', 'uuid', (col) =>
      col.references('ai_messages.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('set null'),
    )
    .addColumn('source_type', 'varchar', (col) => col.notNull())
    .addColumn('source_id', 'uuid', (col) => col.notNull())
    .addColumn('source_title', 'text', (col) => col.notNull())
    .addColumn('source_url', 'text')
    .addColumn('excerpt', 'text')
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('relevance_score', 'double precision')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`"source_type" in ('page', 'database_row', 'attachment', 'chat_file')`,
    )
    .addCheckConstraint(
      'ai_message_sources_position_check',
      sql`"position" >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('uniq_ai_message_sources_message_position')
    .on('ai_message_sources')
    .columns(['message_id', 'position'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_ai_message_sources_page')
    .on('ai_message_sources')
    .column('page_id')
    .where('page_id', 'is not', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ai_message_sources').execute();
  await db.schema.dropTable('ai_chat_files').execute();
  await db.schema.dropTable('ai_runs').execute();
  await db.schema.dropTable('ai_messages').execute();
  await db.schema.dropTable('ai_conversations').execute();
  await db.schema.dropTable('ai_space_configs').execute();
}
