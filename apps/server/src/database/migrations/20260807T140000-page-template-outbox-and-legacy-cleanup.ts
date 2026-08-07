import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table shares
      drop column if exists allow_public_live_embed
  `.execute(db);

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

  await db.schema
    .createTable('page_template_legacy_migration_errors')
    .ifNotExists()
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('consumer_page_id', 'uuid', (column) =>
      column.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('source_page_id', 'uuid')
    .addColumn('reference_node_id', 'varchar', (column) => column.notNull())
    .addColumn('error_code', 'varchar', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_legacy_migration_error_unique', [
      'consumer_page_id',
      'reference_node_id',
    ])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`delete from queue_outbox where kind = 'page_template_sync'`.execute(db);

  await sql`
    alter table queue_outbox
      drop constraint if exists queue_outbox_kind_check,
      add constraint queue_outbox_kind_check check (
        kind in (
          'workspace_invitation_email',
          'workspace_invitation_accepted_email',
          'duplicate_page_attachments'
        )
      )
  `.execute(db);

  await db.schema
    .dropTable('page_template_legacy_migration_errors')
    .ifExists()
    .execute();

  await sql`
    alter table shares
      add column if not exists allow_public_live_embed boolean not null default false
  `.execute(db);
}
