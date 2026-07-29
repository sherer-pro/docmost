import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_conversations')
    .addColumn('client_request_id', 'varchar')
    .addColumn('request_fingerprint', 'varchar')
    .execute();

  await db.schema
    .createIndex('uniq_ai_conversations_workspace_user_request')
    .on('ai_conversations')
    .columns(['workspace_id', 'user_id', 'client_request_id'])
    .unique()
    .where('client_request_id', 'is not', null)
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addColumn('root_run_id', 'uuid')
    .addColumn('previous_run_id', 'uuid')
    .addColumn('attempt_no', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('trigger', 'varchar', (col) =>
      col.notNull().defaultTo('send'),
    )
    .addColumn('reserved_tokens', 'bigint', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('enqueued_at', 'timestamptz')
    .addColumn('response_snapshot', 'text')
    .addColumn('request_fingerprint', 'varchar')
    .execute();

  await sql`
    update ai_runs r
    set
      root_run_id = r.id,
      response_snapshot = case
        when r.status in ('completed', 'failed', 'cancelled') then m.content
        else null
      end
    from ai_messages m
    where m.id = r.assistant_message_id
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (select 1 from ai_runs where root_run_id is null) then
        raise exception 'Cannot backfill ai_runs.root_run_id';
      end if;
    end
    $$;
  `.execute(db);

  await db.schema
    .alterTable('ai_runs')
    .alterColumn('root_run_id', (col) => col.setNotNull())
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addForeignKeyConstraint(
      'ai_runs_root_run_id_fkey',
      ['root_run_id'],
      'ai_runs',
      ['id'],
    )
    .onDelete('cascade')
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addForeignKeyConstraint(
      'ai_runs_previous_run_id_fkey',
      ['previous_run_id'],
      'ai_runs',
      ['id'],
    )
    .onDelete('set null')
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint('ai_runs_attempt_no_check', sql`"attempt_no" > 0`)
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_trigger_check',
      sql`"trigger" in ('send', 'retry', 'regenerate')`,
    )
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_reserved_tokens_check',
      sql`"reserved_tokens" >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('uniq_ai_runs_root_attempt')
    .on('ai_runs')
    .columns(['root_run_id', 'attempt_no'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_ai_runs_queued_enqueued')
    .on('ai_runs')
    .columns(['status', 'enqueued_at', 'created_at'])
    .where('status', '=', 'queued')
    .execute();

  await db.schema
    .alterTable('ai_messages')
    .addColumn('current_run_id', 'uuid')
    .execute();

  await db.schema
    .alterTable('ai_messages')
    .addForeignKeyConstraint(
      'ai_messages_current_run_id_fkey',
      ['current_run_id'],
      'ai_runs',
      ['id'],
    )
    .onDelete('set null')
    .execute();

  await sql`
    update ai_messages m
    set current_run_id = (
      select r.id
      from ai_runs r
      where r.assistant_message_id = m.id
      order by r.attempt_no desc, r.created_at desc, r.id desc
      limit 1
    )
    where m.role = 'assistant'
      and exists (
        select 1 from ai_runs r where r.assistant_message_id = m.id
      )
  `.execute(db);

  await db.schema
    .alterTable('ai_message_sources')
    .addColumn('run_id', 'uuid')
    .execute();

  await db.schema
    .alterTable('ai_message_sources')
    .addForeignKeyConstraint(
      'ai_message_sources_run_id_fkey',
      ['run_id'],
      'ai_runs',
      ['id'],
    )
    .onDelete('cascade')
    .execute();

  await sql`
    update ai_message_sources s
    set run_id = m.current_run_id
    from ai_messages m
    where m.id = s.message_id
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (select 1 from ai_message_sources where run_id is null) then
        raise exception 'Cannot backfill ai_message_sources.run_id';
      end if;
    end
    $$;
  `.execute(db);

  await db.schema
    .alterTable('ai_message_sources')
    .alterColumn('run_id', (col) => col.setNotNull())
    .execute();

  await db.schema
    .dropIndex('uniq_ai_message_sources_message_position')
    .execute();

  await db.schema
    .createIndex('uniq_ai_message_sources_run_position')
    .on('ai_message_sources')
    .columns(['run_id', 'position'])
    .unique()
    .execute();

  await db.schema
    .createTable('ai_file_upload_batches')
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
    .addColumn('idempotency_key', 'varchar', (col) => col.notNull())
    .addColumn('request_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('status', 'varchar', (col) =>
      col.notNull().defaultTo('processing'),
    )
    .addColumn('error_code', 'varchar')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_file_upload_batches_request_unique', [
      'conversation_id',
      'idempotency_key',
    ])
    .addCheckConstraint(
      'ai_file_upload_batches_status_check',
      sql`"status" in ('processing', 'completed', 'failed')`,
    )
    .execute();

  await db.schema
    .dropIndex('idx_ai_chat_files_expiry')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('ai_chat_files')
    .dropColumn('expires_at')
    .addColumn('upload_batch_id', 'uuid')
    .addColumn('upload_ordinal', 'integer')
    .addColumn('content_sha256', 'varchar')
    .addColumn('uploaded_at', 'timestamptz')
    .addColumn('storage_deleted_at', 'timestamptz')
    .addColumn('extraction_started_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('ai_chat_files')
    .addForeignKeyConstraint(
      'ai_chat_files_upload_batch_id_fkey',
      ['upload_batch_id'],
      'ai_file_upload_batches',
      ['id'],
    )
    .onDelete('set null')
    .execute();

  await db.schema
    .alterTable('ai_chat_files')
    .addCheckConstraint(
      'ai_chat_files_upload_ordinal_check',
      sql`"upload_ordinal" is null or "upload_ordinal" >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('uniq_ai_chat_files_batch_ordinal')
    .on('ai_chat_files')
    .columns(['upload_batch_id', 'upload_ordinal'])
    .unique()
    .where('upload_batch_id', 'is not', null)
    .execute();

  await db.schema
    .createIndex('idx_ai_chat_files_cleanup')
    .on('ai_chat_files')
    .columns(['deleted_at', 'storage_deleted_at'])
    .where('deleted_at', 'is not', null)
    .execute();

  await db.schema
    .createIndex('idx_ai_chat_files_extraction')
    .on('ai_chat_files')
    .columns([
      'status',
      'uploaded_at',
      'extraction_started_at',
      'deleted_at',
    ])
    .where('deleted_at', 'is', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_ai_chat_files_extraction').ifExists().execute();
  await db.schema.dropIndex('idx_ai_chat_files_cleanup').ifExists().execute();
  await db.schema
    .dropIndex('uniq_ai_chat_files_batch_ordinal')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('ai_chat_files')
    .dropConstraint('ai_chat_files_upload_batch_id_fkey')
    .execute();
  await db.schema
    .alterTable('ai_chat_files')
    .dropConstraint('ai_chat_files_upload_ordinal_check')
    .execute();
  await db.schema
    .alterTable('ai_chat_files')
    .dropColumn('upload_batch_id')
    .dropColumn('upload_ordinal')
    .dropColumn('content_sha256')
    .dropColumn('uploaded_at')
    .dropColumn('storage_deleted_at')
    .dropColumn('extraction_started_at')
    .addColumn('expires_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_ai_chat_files_expiry')
    .on('ai_chat_files')
    .column('expires_at')
    .where('expires_at', 'is not', null)
    .execute();

  await db.schema.dropTable('ai_file_upload_batches').execute();

  await db.schema
    .dropIndex('uniq_ai_message_sources_run_position')
    .ifExists()
    .execute();
  await db.schema
    .createIndex('uniq_ai_message_sources_message_position')
    .on('ai_message_sources')
    .columns(['message_id', 'position'])
    .unique()
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_run_id_fkey')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .dropColumn('run_id')
    .execute();

  await db.schema
    .alterTable('ai_messages')
    .dropConstraint('ai_messages_current_run_id_fkey')
    .execute();
  await db.schema
    .alterTable('ai_messages')
    .dropColumn('current_run_id')
    .execute();

  await db.schema.dropIndex('idx_ai_runs_queued_enqueued').ifExists().execute();
  await db.schema.dropIndex('uniq_ai_runs_root_attempt').ifExists().execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_reserved_tokens_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_trigger_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_attempt_no_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_previous_run_id_fkey')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_root_run_id_fkey')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('response_snapshot')
    .dropColumn('request_fingerprint')
    .dropColumn('enqueued_at')
    .dropColumn('reserved_tokens')
    .dropColumn('trigger')
    .dropColumn('attempt_no')
    .dropColumn('previous_run_id')
    .dropColumn('root_run_id')
    .execute();

  await db.schema
    .dropIndex('uniq_ai_conversations_workspace_user_request')
    .ifExists()
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropColumn('request_fingerprint')
    .dropColumn('client_request_id')
    .execute();
}
