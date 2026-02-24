import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('push_notification_jobs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('window_key', 'text', (col) => col.notNull())
    .addColumn('idempotency_key', 'text', (col) => col.notNull())
    .addColumn('send_after', 'timestamptz', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('events_count', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('payload', 'jsonb')
    .addColumn('sent_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('uniq_push_notification_jobs_user_page_window')
    .on('push_notification_jobs')
    .columns(['user_id', 'page_id', 'window_key'])
    .unique()
    .execute();

  await db.schema
    .createIndex('uniq_push_notification_jobs_idempotency_key')
    .on('push_notification_jobs')
    .column('idempotency_key')
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_push_notification_jobs_due_pending')
    .on('push_notification_jobs')
    .columns(['status', 'send_after'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('push_notification_jobs').execute();
}
