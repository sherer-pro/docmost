import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('databases')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col)
    .addColumn('icon', 'varchar', (col) => col)
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('last_updated_by_id', 'uuid', (col) =>
      col.references('users.id'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz', (col) => col)
    .execute();

  await db.schema
    .createTable('database_properties')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.references('databases.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('settings', 'jsonb', (col) => col)
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz', (col) => col)
    .execute();

  await db.schema
    .createTable('database_rows')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.references('databases.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('updated_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('archived_at', 'timestamptz', (col) => col)
    .addUniqueConstraint('database_rows_database_id_page_id_unique', [
      'database_id',
      'page_id',
    ])
    .execute();

  await db.schema
    .createTable('database_cells')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.references('databases.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('property_id', 'uuid', (col) =>
      col.references('database_properties.id').onDelete('cascade').notNull(),
    )
    .addColumn('attachment_id', 'uuid', (col) =>
      col.references('attachments.id').onDelete('set null'),
    )
    .addColumn('value', 'jsonb', (col) => col)
    .addColumn('created_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('updated_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz', (col) => col)
    .addUniqueConstraint('database_cells_db_page_property_unique', [
      'database_id',
      'page_id',
      'property_id',
    ])
    .execute();

  await db.schema
    .createTable('database_views')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.references('databases.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('config', 'jsonb', (col) => col)
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz', (col) => col)
    .execute();

  await db.schema
    .createIndex('database_properties_database_id_idx')
    .on('database_properties')
    .column('database_id')
    .execute();

  await db.schema
    .createIndex('database_rows_database_id_idx')
    .on('database_rows')
    .column('database_id')
    .execute();

  await db.schema
    .createIndex('database_cells_database_property_idx')
    .on('database_cells')
    .columns(['database_id', 'property_id'])
    .execute();

  await db.schema
    .createIndex('database_views_database_id_idx')
    .on('database_views')
    .column('database_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('database_views').execute();
  await db.schema.dropTable('database_cells').execute();
  await db.schema.dropTable('database_rows').execute();
  await db.schema.dropTable('database_properties').execute();
  await db.schema.dropTable('databases').execute();
}
