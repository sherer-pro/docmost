import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .addColumn('is_template', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();

  await db.schema
    .alterTable('shares')
    .addColumn('allow_public_live_embed', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    create index pages_template_discovery_idx
      on pages (workspace_id, space_id, updated_at desc, id)
      where is_template = true and deleted_at is null
  `.execute(db);

  await sql`
    alter table page_transclusion_references
      drop constraint if exists page_transclusion_references_source_page_id_fkey,
      drop constraint if exists page_transclusion_references_source_page_id_foreign,
      drop constraint if exists page_transclusion_references_unique,
      alter column transclusion_id drop not null,
      add column reference_kind varchar not null default 'block',
      add column reference_node_id varchar
  `.execute(db);

  await sql`
    alter table page_transclusion_references
      add constraint page_transclusion_references_kind_check check (
        (reference_kind = 'block' and transclusion_id is not null and reference_node_id is null)
        or
        (reference_kind = 'page' and transclusion_id is null and reference_node_id is not null)
      )
  `.execute(db);

  await sql`
    create unique index page_transclusion_references_block_unique
      on page_transclusion_references
        (reference_page_id, source_page_id, transclusion_id)
      where reference_kind = 'block'
  `.execute(db);

  await sql`
    create unique index page_transclusion_references_page_node_unique
      on page_transclusion_references (reference_page_id, reference_node_id)
      where reference_kind = 'page'
  `.execute(db);

  await sql`
    create index page_transclusion_references_source_kind_idx
      on page_transclusion_references
        (workspace_id, reference_kind, source_page_id)
  `.execute(db);

  await sql`
    create index page_transclusion_references_consumer_kind_idx
      on page_transclusion_references
        (workspace_id, reference_kind, reference_page_id)
  `.execute(db);

  await db.schema
    .createTable('page_template_workspace_policies')
    .addColumn('workspace_id', 'uuid', (column) =>
      column
        .primaryKey()
        .references('workspaces.id')
        .onDelete('cascade'),
    )
    .addColumn('enabled', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('revision', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('updated_by_id', 'uuid', (column) =>
      column.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('page_template_space_policies')
    .addColumn('space_id', 'uuid', (column) =>
      column.primaryKey().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('templates_enabled', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_create_template', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_snapshot', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_live_embed', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_public_live_embed', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('revision', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('updated_by_id', 'uuid', (column) =>
      column.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('page_template_space_policies_workspace_idx')
    .on('page_template_space_policies')
    .columns(['workspace_id', 'space_id'])
    .execute();

  await db.schema
    .createTable('page_template_group_policies')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (column) =>
      column.notNull().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (column) =>
      column.notNull().references('groups.id').onDelete('cascade'),
    )
    .addColumn('allowed_actions', 'jsonb')
    .addColumn('revision', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('updated_by_id', 'uuid', (column) =>
      column.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_group_policies_space_group_unique', [
      'space_id',
      'group_id',
    ])
    .execute();

  await db.schema
    .createIndex('page_template_group_policies_group_idx')
    .on('page_template_group_policies')
    .column('group_id')
    .execute();

  await db.schema
    .createTable('page_embed_graph_fences')
    .addColumn('workspace_id', 'uuid', (column) =>
      column
        .primaryKey()
        .references('workspaces.id')
        .onDelete('cascade'),
    )
    .addColumn('last_token', 'bigint', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('page_template_operations')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('requested_by_id', 'uuid', (column) =>
      column.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('operation_kind', 'varchar', (column) => column.notNull())
    .addColumn('idempotency_key', 'varchar', (column) => column.notNull())
    .addColumn('request_hash', 'varchar', (column) => column.notNull())
    .addColumn('source_page_id', 'uuid')
    .addColumn('consumer_page_id', 'uuid')
    .addColumn('reference_node_id', 'varchar')
    .addColumn('result_page_id', 'uuid')
    .addColumn('base_content_hash', 'varchar')
    .addColumn('after_content_hash', 'varchar')
    .addColumn('graph_fencing_token', 'bigint')
    .addColumn('attachment_mapping', 'jsonb')
    .addColumn('staged_content', 'jsonb')
    .addColumn('lease_token', 'varchar')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('attempt_count', 'integer', (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn('status', 'varchar', (column) =>
      column.notNull().defaultTo('pending'),
    )
    .addColumn('error_code', 'varchar')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_operations_idempotency_unique', [
      'workspace_id',
      'requested_by_id',
      'operation_kind',
      'idempotency_key',
    ])
    .addCheckConstraint(
      'page_template_operations_kind_check',
      sql`operation_kind in ('snapshot', 'embed_insert', 'embed_detach')`,
    )
    .addCheckConstraint(
      'page_template_operations_status_check',
      sql`status in ('pending', 'completed', 'failed')`,
    )
    .execute();

  await db.schema
    .createIndex('page_template_operations_pending_idx')
    .on('page_template_operations')
    .columns(['workspace_id', 'status', 'created_at'])
    .execute();

  await sql`
    create unique index page_template_operations_detach_occurrence_pending_unique
      on page_template_operations
        (workspace_id, consumer_page_id, reference_node_id)
      where operation_kind = 'embed_detach' and status = 'pending'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('page_template_operations').ifExists().execute();
  await db.schema.dropTable('page_embed_graph_fences').ifExists().execute();
  await db.schema
    .dropTable('page_template_group_policies')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_space_policies')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_workspace_policies')
    .ifExists()
    .execute();

  await sql`
    delete from page_transclusion_references where reference_kind = 'page'
  `.execute(db);
  await sql`
    drop index if exists page_transclusion_references_consumer_kind_idx;
    drop index if exists page_transclusion_references_source_kind_idx;
    drop index if exists page_transclusion_references_page_node_unique;
    drop index if exists page_transclusion_references_block_unique;
    alter table page_transclusion_references
      drop constraint if exists page_transclusion_references_kind_check,
      drop column if exists reference_node_id,
      drop column if exists reference_kind,
      alter column transclusion_id set not null,
      add constraint page_transclusion_references_source_page_id_fkey
        foreign key (source_page_id) references pages(id) on delete cascade,
      add constraint page_transclusion_references_unique
        unique (reference_page_id, source_page_id, transclusion_id)
  `.execute(db);

  await sql`drop index if exists pages_template_discovery_idx`.execute(db);
  await db.schema.alterTable('pages').dropColumn('is_template').execute();
  await db.schema
    .alterTable('shares')
    .dropColumn('allow_public_live_embed')
    .execute();
}
