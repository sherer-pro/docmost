import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('page_history')
    .addColumn('change_type', 'varchar')
    .addColumn('change_data', 'jsonb')
    .execute();

  await db
    .updateTable('page_history')
    .set({
      change_data: sql`jsonb_build_object('eventVersion', 1)`,
    })
    .where('change_data', 'is', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('page_history')
    .dropColumn('change_data')
    .dropColumn('change_type')
    .execute();
}
