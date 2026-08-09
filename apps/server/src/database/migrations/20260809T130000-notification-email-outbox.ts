import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table queue_outbox
      drop constraint if exists queue_outbox_kind_check,
      add constraint queue_outbox_kind_check check (
        kind in (
          'workspace_invitation_email',
          'workspace_invitation_accepted_email',
          'duplicate_page_attachments',
          'page_template_sync',
          'notification_email'
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`delete from queue_outbox where kind = 'notification_email'`.execute(
    db,
  );
  await sql`
    alter table queue_outbox
      drop constraint if exists queue_outbox_kind_check,
      add constraint queue_outbox_kind_check check (
        kind in (
          'workspace_invitation_email',
          'workspace_invitation_accepted_email',
          'duplicate_page_attachments',
          'page_template_sync'
        )
      )
  `.execute(db);
}
