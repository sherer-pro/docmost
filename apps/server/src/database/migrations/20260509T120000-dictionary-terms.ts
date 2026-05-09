import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('dictionary_terms')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('term', 'varchar(255)', (col) => col.notNull())
    .addColumn('definition_markdown', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz', (col) => col)
    .execute();

  await db.schema
    .createTable('dictionary_term_aliases')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('term_id', 'uuid', (col) =>
      col.references('dictionary_terms.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('alias', 'varchar(255)', (col) => col.notNull())
    .addColumn('normalized_alias', 'varchar(255)', (col) => col.notNull())
    .addColumn('is_primary', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('dictionary_terms_space_id_idx')
    .on('dictionary_terms')
    .column('space_id')
    .execute();

  await db.schema
    .createIndex('dictionary_term_aliases_term_id_idx')
    .on('dictionary_term_aliases')
    .column('term_id')
    .execute();

  await db.schema
    .createIndex('dictionary_term_aliases_space_normalized_unique_idx')
    .on('dictionary_term_aliases')
    .columns(['space_id', 'normalized_alias'])
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('dictionary_term_aliases_space_normalized_unique_idx')
    .execute();
  await db.schema.dropIndex('dictionary_term_aliases_term_id_idx').execute();
  await db.schema.dropIndex('dictionary_terms_space_id_idx').execute();
  await db.schema.dropTable('dictionary_term_aliases').execute();
  await db.schema.dropTable('dictionary_terms').execute();
}
