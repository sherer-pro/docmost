import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('database_properties_database_id_updated_at_idx')
    .on('database_properties')
    .columns(['database_id', 'updated_at'])
    .execute();

  await db.schema
    .createIndex('database_rows_database_id_updated_at_idx')
    .on('database_rows')
    .columns(['database_id', 'updated_at'])
    .execute();

  await db.schema
    .createIndex('database_cells_database_id_updated_at_idx')
    .on('database_cells')
    .columns(['database_id', 'updated_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('database_properties_database_id_updated_at_idx')
    .execute();
  await db.schema.dropIndex('database_rows_database_id_updated_at_idx').execute();
  await db.schema
    .dropIndex('database_cells_database_id_updated_at_idx')
    .execute();
}
