import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('page_history')
    .addColumn('source_batch_id', 'uuid')
    .execute();
  await db.schema
    .alterTable('page_history')
    .addUniqueConstraint('page_history_page_source_batch_unique', [
      'page_id',
      'source_batch_id',
    ])
    .execute();

  await db.schema
    .alterTable('workspaces')
    .addColumn('page_history_retention_days', 'integer')
    .execute();
  await db.schema
    .alterTable('workspaces')
    .addCheckConstraint(
      'workspaces_page_history_retention_days_check',
      sql`page_history_retention_days is null or page_history_retention_days between 30 and 3650`,
    )
    .execute();

  await sql`
    create index if not exists idx_page_history_page_created_id
    on page_history (page_id, created_at desc, id desc)
  `.execute(db);
  await sql`
    create index if not exists idx_page_history_page_id
    on page_history (page_id, id desc)
  `.execute(db);
  await sql`
    create index if not exists idx_page_history_workspace_created_id
    on page_history (workspace_id, created_at, id)
  `.execute(db);

  await db.schema
    .createIndex('idx_attachments_page_id')
    .ifNotExists()
    .on('attachments')
    .column('page_id')
    .execute();
  await sql`
    create index if not exists idx_attachments_avatar_creator
    on attachments (creator_id)
    where type = 'avatar'
  `.execute(db);
  await db.schema
    .createIndex('idx_attachments_workspace_id')
    .ifNotExists()
    .on('attachments')
    .column('workspace_id')
    .execute();
  await db.schema
    .createIndex('idx_attachments_file_path')
    .ifNotExists()
    .on('attachments')
    .column('file_path')
    .execute();

  await sql`
    update queue_outbox
    set
      payload = case kind
        when 'workspace_invitation_email' then jsonb_strip_nulls(
          jsonb_build_object(
            'redacted', true,
            'workspaceId', payload ->> 'workspaceId',
            'invitationId', payload ->> 'invitationId'
          )
        )
        when 'workspace_invitation_accepted_email' then jsonb_strip_nulls(
          jsonb_build_object(
            'redacted', true,
            'invitationId', payload ->> 'invitationId',
            'acceptedUserId', payload ->> 'acceptedUserId'
          )
        )
        else payload
      end,
      dedupe_key = 'failed:' || id::text,
      secret_payload = null,
      updated_at = now()
    where status = 'failed'
      and kind in (
        'workspace_invitation_email',
        'workspace_invitation_accepted_email'
      )
  `.execute(db);

  await sql`
    create index if not exists idx_queue_outbox_completed_terminal
    on queue_outbox (completed_at, id)
    where status = 'completed'
  `.execute(db);
  await sql`
    create index if not exists idx_queue_outbox_cancelled_terminal
    on queue_outbox (cancelled_at, id)
    where status = 'cancelled'
  `.execute(db);
  await sql`
    create index if not exists idx_queue_outbox_failed_terminal
    on queue_outbox (failed_at, id)
    where status = 'failed'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_queue_outbox_failed_terminal')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_queue_outbox_cancelled_terminal')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_queue_outbox_completed_terminal')
    .ifExists()
    .execute();

  await db.schema.dropIndex('idx_attachments_file_path').ifExists().execute();
  await db.schema.dropIndex('idx_attachments_workspace_id').ifExists().execute();
  await db.schema
    .dropIndex('idx_attachments_avatar_creator')
    .ifExists()
    .execute();
  await db.schema.dropIndex('idx_attachments_page_id').ifExists().execute();
  await db.schema
    .dropIndex('idx_page_history_workspace_created_id')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_page_history_page_id')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_page_history_page_created_id')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('workspaces')
    .dropConstraint('workspaces_page_history_retention_days_check')
    .execute();
  await db.schema
    .alterTable('workspaces')
    .dropColumn('page_history_retention_days')
    .execute();

  await db.schema
    .alterTable('page_history')
    .dropConstraint('page_history_page_source_batch_unique')
    .execute();
  await db.schema
    .alterTable('page_history')
    .dropColumn('source_batch_id')
    .execute();
}
