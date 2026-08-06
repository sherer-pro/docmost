import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('notifications')
    .addColumn('deduplication_key', 'text')
    .execute();

  await db.schema
    .createIndex('uniq_notifications_deduplication_key')
    .unique()
    .on('notifications')
    .column('deduplication_key')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('uniq_notifications_deduplication_key').execute();
  await db.schema
    .alterTable('notifications')
    .dropColumn('deduplication_key')
    .execute();
}
