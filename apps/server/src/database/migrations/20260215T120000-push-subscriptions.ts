import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('push_subscriptions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('endpoint', 'text', (col) => col.notNull())
    .addColumn('p256dh', 'text', (col) => col.notNull())
    .addColumn('auth', 'text', (col) => col.notNull())
    .addColumn('user_agent', 'text')
    .addColumn('last_seen_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_push_subscriptions_endpoint_unique')
    .on('push_subscriptions')
    .column('endpoint')
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_push_subscriptions_user_id')
    .on('push_subscriptions')
    .column('user_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('push_subscriptions').execute();
}
