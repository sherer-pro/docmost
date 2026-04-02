import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('page_access_rules')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('principal_type', 'varchar', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade'),
    )
    .addColumn('effect', 'varchar', (col) => col.notNull())
    .addColumn('role', 'varchar')
    .addColumn('source_page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('set null'),
    )
    .addColumn('added_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'page_access_rules_principal_type_check',
      sql`"principal_type" in ('user', 'group')`,
    )
    .addCheckConstraint(
      'page_access_rules_effect_check',
      sql`"effect" in ('allow', 'deny')`,
    )
    .addCheckConstraint(
      'page_access_rules_principal_scope_check',
      sql`(
        ("principal_type" = 'user' and "user_id" is not null and "group_id" is null)
        or ("principal_type" = 'group' and "group_id" is not null and "user_id" is null)
      )`,
    )
    .addCheckConstraint(
      'page_access_rules_role_check',
      sql`(
        ("effect" = 'deny' and "role" is null)
        or ("effect" = 'allow' and "role" in ('reader', 'writer'))
      )`,
    )
    .execute();

  await db.schema
    .createIndex('idx_page_access_rules_page_id')
    .on('page_access_rules')
    .column('page_id')
    .execute();

  await db.schema
    .createIndex('idx_page_access_rules_workspace_user')
    .on('page_access_rules')
    .columns(['workspace_id', 'user_id'])
    .where('user_id', 'is not', null)
    .execute();

  await db.schema
    .createIndex('idx_page_access_rules_workspace_group')
    .on('page_access_rules')
    .columns(['workspace_id', 'group_id'])
    .where('group_id', 'is not', null)
    .execute();

  await db.schema
    .createIndex('idx_page_access_rules_page_user_unique')
    .on('page_access_rules')
    .columns(['page_id', 'user_id'])
    .unique()
    .where('user_id', 'is not', null)
    .execute();

  await db.schema
    .createIndex('idx_page_access_rules_page_group_unique')
    .on('page_access_rules')
    .columns(['page_id', 'group_id'])
    .unique()
    .where('group_id', 'is not', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('page_access_rules').execute();
}
