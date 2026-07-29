import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_conversations')
    .addColumn('include_current_document', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('context_revision', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('context_fingerprint', 'varchar', (col) =>
      col.notNull().defaultTo('initial'),
    )
    .addColumn('context_chat_file_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('context_attachment_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('title_source', 'varchar')
    .execute();

  await sql`
    update ai_conversations
    set title_source = 'manual'
    where title is not null and btrim(title) <> ''
  `.execute(db);

  await db.schema
    .alterTable('ai_conversations')
    .addCheckConstraint(
      'ai_conversations_context_revision_check',
      sql`"context_revision" >= 0`,
    )
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .addCheckConstraint(
      'ai_conversations_title_source_check',
      sql`
        "title_source" is null
        or "title_source" in ('manual', 'generated', 'fallback')
      `,
    )
    .execute();

  await db.schema
    .createTable('ai_conversation_context_sources')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('conversation_id', 'uuid', (col) =>
      col.references('ai_conversations.id').onDelete('cascade').notNull(),
    )
    .addColumn('source_type', 'varchar', (col) => col.notNull())
    .addColumn('source_id', 'uuid', (col) => col.notNull())
    .addColumn('page_id', 'uuid', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'ai_conversation_context_sources_type_check',
      sql`"source_type" in ('page', 'database', 'database_row')`,
    )
    .addCheckConstraint(
      'ai_conversation_context_sources_position_check',
      sql`"position" >= 0 and "position" < 10`,
    )
    .addUniqueConstraint('ai_conversation_context_sources_identity_unique', [
      'conversation_id',
      'source_type',
      'source_id',
    ])
    .addUniqueConstraint('ai_conversation_context_sources_position_unique', [
      'conversation_id',
      'position',
    ])
    .execute();

  await db.schema
    .createIndex('idx_ai_conversation_context_sources_page')
    .on('ai_conversation_context_sources')
    .column('page_id')
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addColumn('context_revision', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_context_revision_check',
      sql`"context_revision" >= 0`,
    )
    .execute();

  await db.schema
    .createTable('ai_run_context_sources')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.references('ai_runs.id').onDelete('cascade').notNull(),
    )
    .addColumn('origin', 'varchar', (col) => col.notNull())
    .addColumn('source_type', 'varchar', (col) => col.notNull())
    .addColumn('source_id', 'uuid', (col) => col.notNull())
    .addColumn('page_id', 'uuid', (col) => col.notNull())
    .addColumn('source_title', 'text', (col) => col.notNull())
    .addColumn('source_url', 'text')
    .addColumn('markdown_snapshot', 'text', (col) => col.notNull())
    .addColumn('content_sha256', 'varchar', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'ai_run_context_sources_origin_check',
      sql`"origin" in ('current_document', 'explicit')`,
    )
    .addCheckConstraint(
      'ai_run_context_sources_type_check',
      sql`"source_type" in ('page', 'database', 'database_row')`,
    )
    .addCheckConstraint(
      'ai_run_context_sources_position_check',
      sql`"position" >= 0`,
    )
    .addUniqueConstraint('ai_run_context_sources_position_unique', [
      'run_id',
      'position',
    ])
    .execute();

  await db.schema
    .createIndex('idx_ai_run_context_sources_source')
    .on('ai_run_context_sources')
    .columns(['source_type', 'source_id'])
    .execute();

  await db.schema
    .createTable('ai_run_source_dependencies')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.references('ai_runs.id').onDelete('cascade').notNull(),
    )
    .addColumn('message_id', 'uuid', (col) =>
      col.references('ai_messages.id').onDelete('cascade').notNull(),
    )
    .addColumn('context_source_id', 'uuid', (col) =>
      col.references('ai_run_context_sources.id').onDelete('set null'),
    )
    .addColumn('page_id', 'uuid', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_run_source_dependencies_page_unique', [
      'run_id',
      'page_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_ai_run_source_dependencies_message')
    .on('ai_run_source_dependencies')
    .column('message_id')
    .execute();

  await db.schema
    .createIndex('idx_ai_run_source_dependencies_page')
    .on('ai_run_source_dependencies')
    .column('page_id')
    .execute();

  await db.schema
    .createTable('ai_aux_runs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('kind', 'varchar', (col) => col.notNull())
    .addColumn('status', 'varchar', (col) => col.notNull().defaultTo('queued'))
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) => col.notNull())
    .addColumn('conversation_id', 'uuid', (col) =>
      col.references('ai_conversations.id').onDelete('cascade'),
    )
    .addColumn('source_run_id', 'uuid', (col) =>
      col.references('ai_runs.id').onDelete('set null'),
    )
    .addColumn('client_request_id', 'varchar')
    .addColumn('request_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('command_id', 'varchar')
    .addColumn('instruction', 'text')
    .addColumn('input_snapshot', 'text')
    .addColumn('selection_text', 'text')
    .addColumn('selection_from', 'integer')
    .addColumn('selection_to', 'integer')
    .addColumn('snapshot_hash', 'varchar')
    .addColumn('response_snapshot', 'text', (col) =>
      col.notNull().defaultTo(''),
    )
    .addColumn('result_title', 'varchar')
    .addColumn('sequence', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('reserved_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('input_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('attempt_no', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('heartbeat_at', 'timestamptz')
    .addColumn('enqueued_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('cancel_requested_at', 'timestamptz')
    .addColumn('error_code', 'varchar')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('expires_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now() + interval '24 hours'`),
    )
    .addCheckConstraint(
      'ai_aux_runs_kind_check',
      sql`"kind" in ('conversation_title', 'editor_transform')`,
    )
    .addCheckConstraint(
      'ai_aux_runs_status_check',
      sql`"status" in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    )
    .addCheckConstraint('ai_aux_runs_sequence_check', sql`"sequence" >= 0`)
    .addCheckConstraint(
      'ai_aux_runs_token_counts_check',
      sql`
        "reserved_tokens" >= 0
        and "input_tokens" >= 0
        and "output_tokens" >= 0
      `,
    )
    .addCheckConstraint(
      'ai_aux_runs_attempt_no_check',
      sql`"attempt_no" > 0 and "attempt_no" <= 3`,
    )
    .addCheckConstraint(
      'ai_aux_runs_selection_range_check',
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
    .createIndex('uniq_ai_aux_runs_conversation_title')
    .on('ai_aux_runs')
    .column('conversation_id')
    .unique()
    .where(sql<boolean>`kind = 'conversation_title'`)
    .execute();

  await db.schema
    .createIndex('uniq_ai_aux_runs_editor_request')
    .on('ai_aux_runs')
    .columns(['user_id', 'client_request_id'])
    .unique()
    .where(sql<boolean>`kind = 'editor_transform'`)
    .execute();

  await db.schema
    .createIndex('idx_ai_aux_runs_queued_enqueued')
    .on('ai_aux_runs')
    .columns(['status', 'enqueued_at', 'created_at'])
    .where('status', '=', 'queued')
    .execute();

  await db.schema
    .createIndex('idx_ai_aux_runs_expiry')
    .on('ai_aux_runs')
    .column('expires_at')
    .execute();

  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_source_type_check')
    .execute();

  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`"source_type" in ('page', 'database', 'database_row', 'attachment', 'chat_file')`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_source_type_check')
    .execute();

  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`"source_type" in ('page', 'database_row', 'attachment', 'chat_file')`,
    )
    .execute();

  await db.schema.dropTable('ai_aux_runs').execute();
  await db.schema.dropTable('ai_run_source_dependencies').execute();
  await db.schema.dropTable('ai_run_context_sources').execute();
  await db.schema.dropTable('ai_conversation_context_sources').execute();

  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_context_revision_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('context_revision')
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .dropConstraint('ai_conversations_title_source_check')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropConstraint('ai_conversations_context_revision_check')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropColumn('title_source')
    .dropColumn('context_attachment_ids')
    .dropColumn('context_chat_file_ids')
    .dropColumn('context_fingerprint')
    .dropColumn('context_revision')
    .dropColumn('include_current_document')
    .execute();
}
