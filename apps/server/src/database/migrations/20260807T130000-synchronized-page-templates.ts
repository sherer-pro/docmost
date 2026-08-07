import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .addColumn('template_kind', 'varchar')
    .addColumn('template_archived_at', 'timestamptz')
    .execute();

  await sql`
    update pages
    set template_kind = 'regular'
    where is_template = true
  `.execute(db);

  await sql`
    alter table pages
      add constraint pages_template_kind_check
      check (template_kind is null or template_kind in ('regular', 'synced'))
  `.execute(db);

  await sql`drop index if exists pages_template_discovery_idx`.execute(db);
  await sql`
    create index pages_template_discovery_idx
      on pages (workspace_id, space_id, template_kind, updated_at desc, id)
      where template_kind is not null and deleted_at is null
  `.execute(db);

  await db.schema.alterTable('pages').dropColumn('is_template').execute();

  await db.schema
    .alterTable('page_template_space_policies')
    .addColumn('allow_regular_template', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_synced_template', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    update page_template_space_policies
    set
      allow_regular_template = allow_snapshot,
      allow_synced_template = allow_live_embed
  `.execute(db);

  await db.schema
    .alterTable('page_template_space_policies')
    .dropColumn('allow_snapshot')
    .dropColumn('allow_live_embed')
    .dropColumn('allow_public_live_embed')
    .execute();

  await sql`
    update page_template_group_policies
    set allowed_actions = replace(
      replace(
        allowed_actions::text,
        '"use_snapshot"',
        '"use_regular_template"'
      ),
      '"use_live_embed"',
      '"use_synced_template"'
    )::jsonb
    where allowed_actions is not null
  `.execute(db);

  await db.schema
    .createTable('page_template_revisions')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (column) =>
      column.notNull().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('template_page_id', 'uuid', (column) =>
      column.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('revision', 'integer', (column) => column.notNull())
    .addColumn('content', 'jsonb', (column) => column.notNull())
    .addColumn('content_hash', 'varchar', (column) => column.notNull())
    .addColumn('published_by_id', 'uuid', (column) =>
      column.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_revisions_template_revision_unique', [
      'template_page_id',
      'revision',
    ])
    .execute();

  await db.schema
    .createIndex('page_template_revisions_template_created_idx')
    .on('page_template_revisions')
    .columns(['template_page_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('page_template_instances')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (column) =>
      column.notNull().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('template_page_id', 'uuid', (column) =>
      column.references('pages.id').onDelete('set null'),
    )
    .addColumn('child_page_id', 'uuid', (column) =>
      column.notNull().unique().references('pages.id').onDelete('cascade'),
    )
    .addColumn('instance_kind', 'varchar', (column) => column.notNull())
    .addColumn('created_revision', 'integer')
    .addColumn('applied_revision', 'integer')
    .addColumn('status', 'varchar', (column) =>
      column.notNull().defaultTo('active'),
    )
    .addColumn('last_error_code', 'varchar')
    .addColumn('detached_at', 'timestamptz')
    .addColumn('detached_by_id', 'uuid', (column) =>
      column.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'page_template_instances_kind_check',
      sql`instance_kind in ('regular', 'synced')`,
    )
    .addCheckConstraint(
      'page_template_instances_status_check',
      sql`status in ('snapshot', 'active', 'syncing', 'error', 'detached')`,
    )
    .execute();

  await db.schema
    .createIndex('page_template_instances_active_template_idx')
    .on('page_template_instances')
    .columns(['template_page_id', 'status', 'updated_at'])
    .execute();

  await db.schema
    .createTable('page_template_sync_runs')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (column) =>
      column.notNull().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('template_page_id', 'uuid', (column) =>
      column.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('revision_id', 'uuid', (column) =>
      column
        .notNull()
        .references('page_template_revisions.id')
        .onDelete('cascade'),
    )
    .addColumn('revision', 'integer', (column) => column.notNull())
    .addColumn('requested_by_id', 'uuid', (column) =>
      column.references('users.id').onDelete('set null'),
    )
    .addColumn('status', 'varchar', (column) =>
      column.notNull().defaultTo('pending'),
    )
    .addColumn('total_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('processed_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('succeeded_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('failed_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('error_code', 'varchar')
    .addColumn('lease_token', 'uuid')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'page_template_sync_runs_status_check',
      sql`status in ('pending', 'running', 'completed', 'partial', 'failed')`,
    )
    .execute();

  await db.schema
    .createIndex('page_template_sync_runs_pending_idx')
    .on('page_template_sync_runs')
    .columns(['status', 'created_at'])
    .execute();

  await db.schema
    .createTable('page_template_sync_items')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('run_id', 'uuid', (column) =>
      column
        .notNull()
        .references('page_template_sync_runs.id')
        .onDelete('cascade'),
    )
    .addColumn('instance_id', 'uuid', (column) =>
      column
        .notNull()
        .references('page_template_instances.id')
        .onDelete('cascade'),
    )
    .addColumn('child_page_id', 'uuid', (column) =>
      column.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('status', 'varchar', (column) =>
      column.notNull().defaultTo('pending'),
    )
    .addColumn('attempt_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('error_code', 'varchar')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_sync_items_run_instance_unique', [
      'run_id',
      'instance_id',
    ])
    .addCheckConstraint(
      'page_template_sync_items_status_check',
      sql`status in ('pending', 'running', 'completed', 'failed')`,
    )
    .execute();

  await db.schema
    .createTable('page_template_attachment_mappings')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('instance_id', 'uuid', (column) =>
      column
        .notNull()
        .references('page_template_instances.id')
        .onDelete('cascade'),
    )
    .addColumn('source_attachment_id', 'uuid', (column) =>
      column.notNull().references('attachments.id').onDelete('cascade'),
    )
    .addColumn('child_attachment_id', 'uuid', (column) =>
      column.notNull().references('attachments.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_attachment_mappings_source_unique', [
      'instance_id',
      'source_attachment_id',
    ])
    .execute();

  await db.schema
    .createTable('page_template_publish_confirmations')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('template_page_id', 'uuid', (column) =>
      column.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('requested_by_id', 'uuid', (column) =>
      column.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('draft_hash', 'varchar', (column) => column.notNull())
    .addColumn('removed_field_ids', 'jsonb', (column) => column.notNull())
    .addColumn('filled_instance_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table page_template_operations
      drop constraint if exists page_template_operations_kind_check,
      add constraint page_template_operations_kind_check check (
        operation_kind in (
          'snapshot',
          'embed_insert',
          'embed_detach',
          'template_sync',
          'template_detach',
          'legacy_embed_migration'
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table page_template_operations
      drop constraint if exists page_template_operations_kind_check,
      add constraint page_template_operations_kind_check check (
        operation_kind in ('snapshot', 'embed_insert', 'embed_detach')
      )
  `.execute(db);

  await db.schema
    .dropTable('page_template_publish_confirmations')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_attachment_mappings')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_sync_items')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_sync_runs')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_instances')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('page_template_revisions')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('page_template_space_policies')
    .addColumn('allow_snapshot', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_live_embed', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('allow_public_live_embed', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    update page_template_space_policies
    set
      allow_snapshot = allow_regular_template,
      allow_live_embed = allow_synced_template
  `.execute(db);

  await db.schema
    .alterTable('page_template_space_policies')
    .dropColumn('allow_regular_template')
    .dropColumn('allow_synced_template')
    .execute();

  await sql`
    update page_template_group_policies
    set allowed_actions = replace(
      replace(
        allowed_actions::text,
        '"use_regular_template"',
        '"use_snapshot"'
      ),
      '"use_synced_template"',
      '"use_live_embed"'
    )::jsonb
    where allowed_actions is not null
  `.execute(db);

  await db.schema
    .alterTable('pages')
    .addColumn('is_template', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    update pages
    set is_template = template_kind is not null
  `.execute(db);

  await sql`drop index if exists pages_template_discovery_idx`.execute(db);
  await db.schema
    .alterTable('pages')
    .dropConstraint('pages_template_kind_check')
    .execute();
  await db.schema
    .alterTable('pages')
    .dropColumn('template_archived_at')
    .dropColumn('template_kind')
    .execute();

  await sql`
    create index pages_template_discovery_idx
      on pages (workspace_id, space_id, updated_at desc, id)
      where is_template = true and deleted_at is null
  `.execute(db);
}
