import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended('docmost-page-embed-removal', 0)
    )
  `.execute(db);
  await sql`
    create table if not exists page_embed_removal_ledger (
      page_id uuid primary key references pages(id) on delete cascade,
      content_hash varchar not null,
      ydoc_hash varchar,
      contract_version integer not null check (contract_version = 1),
      verified_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`
    create table if not exists page_embed_attachment_clone_ledger (
      clone_attachment_id uuid primary key,
      consumer_page_id uuid not null references pages(id) on delete restrict,
      source_page_id uuid not null references pages(id) on delete restrict,
      source_attachment_id uuid not null references attachments(id) on delete restrict,
      workspace_id uuid not null,
      space_id uuid not null,
      source_file_path varchar not null,
      target_file_path varchar not null unique,
      source_metadata_hash varchar not null,
      status varchar not null default 'pending' check (
        status in ('pending', 'copied', 'completed', 'cleanup_pending')
      ),
      attempt_count integer not null default 0,
      last_error_code varchar,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (consumer_page_id, source_attachment_id)
    )
  `.execute(db);
  await sql`
    create index if not exists page_embed_attachment_clone_ledger_status_idx
      on page_embed_attachment_clone_ledger (status, clone_attachment_id)
      where status <> 'completed'
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (
        select 1
        from pages as page
        left join page_embed_removal_ledger as ledger
          on ledger.page_id = page.id
        where ledger.page_id is null
      ) then
        raise exception 'legacy pageEmbed removal blocked: run page-embed:prepare-removal before T040';
      end if;

      if exists (
        select 1
        from pages as page
        join page_embed_removal_ledger as ledger
          on ledger.page_id = page.id
        where ledger.contract_version <> 1
          or ledger.content_hash <>
            md5(coalesce(page.content::text, ''))
          or ledger.ydoc_hash is distinct from case
            when page.ydoc is null then null
            else md5(encode(page.ydoc, 'hex'))
          end
      ) then
        raise exception 'legacy pageEmbed removal blocked: page content changed after semantic cleanup verification';
      end if;

      if exists (
        select 1 from page_embed_attachment_clone_ledger
        where status <> 'completed'
      ) then
        raise exception 'legacy pageEmbed removal blocked: attachment clones are incomplete';
      end if;

      if exists (
        select 1
        from page_embed_attachment_clone_ledger as ledger
        left join attachments as destination
          on destination.id = ledger.clone_attachment_id
        where ledger.status = 'completed'
          and (
            destination.id is null
            or destination.deleted_at is not null
            or destination.page_id is distinct from ledger.consumer_page_id
            or destination.workspace_id is distinct from ledger.workspace_id
            or destination.space_id is distinct from ledger.space_id
            or destination.file_path is distinct from ledger.target_file_path
          )
      ) then
        raise exception 'legacy pageEmbed removal blocked: completed attachment clone ownership is inconsistent';
      end if;

      if exists (
        select 1 from pages
        where
          jsonb_path_exists(coalesce(content, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
      ) then
        raise exception 'legacy pageEmbed removal blocked: pages still contain pageEmbed data';
      end if;

      if exists (
        select 1 from page_history
        where
          jsonb_path_exists(coalesce(content, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
          or jsonb_path_exists(coalesce(change_data, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
      ) then
        raise exception 'legacy pageEmbed removal blocked: page history still contains pageEmbed nodes';
      end if;

      if exists (
        select 1 from page_transclusions
        where jsonb_path_exists(content, '$.** ? (@.type == "pageEmbed")')
      ) then
        raise exception 'legacy pageEmbed removal blocked: synced block data still contains pageEmbed nodes';
      end if;

      if exists (
        select 1 from page_template_revisions
        where jsonb_path_exists(content, '$.** ? (@.type == "pageEmbed")')
      ) then
        raise exception 'legacy pageEmbed removal blocked: template revisions still contain pageEmbed nodes';
      end if;

      if exists (
        select 1 from page_template_operations
        where jsonb_path_exists(coalesce(staged_content, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
      ) then
        raise exception 'legacy pageEmbed removal blocked: staged template operations still contain pageEmbed nodes';
      end if;

      if exists (
        select 1 from databases
        where jsonb_path_exists(coalesce(description_content, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
      ) or exists (
        select 1 from database_cells
        where jsonb_path_exists(coalesce(value, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
      ) or exists (
        select 1 from comments
        where jsonb_path_exists(coalesce(content, 'null'::jsonb), '$.** ? (@.type == "pageEmbed")')
      ) then
        raise exception 'legacy pageEmbed removal blocked: rich content still contains pageEmbed nodes';
      end if;

      if exists (
        select 1 from page_transclusion_references
        where reference_kind = 'page'
          or transclusion_id is null
          or reference_node_id is not null
      ) then
        raise exception 'legacy pageEmbed removal blocked: whole-page reference rows still exist';
      end if;

      if exists (
        select 1
        from page_transclusion_references as reference
        where reference.reference_kind = 'block'
          and not exists (
            select 1 from pages as source
            where source.id = reference.source_page_id
          )
      ) then
        raise exception 'legacy pageEmbed removal blocked: orphan block transclusion references still exist';
      end if;

      if exists (
        select 1
        from page_transclusion_references as reference
        left join pages as consumer
          on consumer.id = reference.reference_page_id
        left join pages as source
          on source.id = reference.source_page_id
        where consumer.id is null
          or (
            source.id is not null
            and (
              reference.workspace_id <> consumer.workspace_id
              or reference.workspace_id <> source.workspace_id
            )
          )
      ) then
        raise exception 'legacy pageEmbed removal blocked: transclusion reference workspace ownership is inconsistent';
      end if;

      if exists (
        select 1 from page_template_operations
        where operation_kind in ('embed_insert', 'embed_detach', 'legacy_embed_migration')
          and status = 'pending'
      ) then
        raise exception 'legacy pageEmbed removal blocked: pending embed operations still exist';
      end if;

      if exists (
        select 1 from page_template_operations
        where operation_kind in ('embed_insert', 'embed_detach', 'legacy_embed_migration')
          and status = 'failed'
          and (
            coalesce(attachment_mapping, 'null'::jsonb) not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
            or coalesce(staged_content, 'null'::jsonb) not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
          )
      ) then
        raise exception 'legacy pageEmbed removal blocked: failed embed operations retain cleanup evidence';
      end if;
    end $$
  `.execute(db);

  await sql`
    delete from page_template_operations
    where operation_kind in ('embed_insert', 'embed_detach', 'legacy_embed_migration')
  `.execute(db);

  await sql`
    drop index if exists page_template_operations_detach_occurrence_pending_unique;
    alter table page_template_operations
      drop constraint if exists page_template_operations_kind_check,
      drop column if exists graph_fencing_token,
      drop column if exists reference_node_id,
      add constraint page_template_operations_kind_check check (
        operation_kind in (
          'snapshot',
          'page_duplicate',
          'template_sync',
          'template_detach'
        )
      )
  `.execute(db);

  await sql`
    drop index if exists page_transclusion_references_page_node_unique;
    drop index if exists page_transclusion_references_source_kind_idx;
    drop index if exists page_transclusion_references_consumer_kind_idx;
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

  await db.schema.dropTable('page_embed_graph_fences').ifExists().execute();
  await db.schema
    .dropTable('page_template_legacy_migration_errors')
    .ifExists()
    .execute();
  await db.schema.dropTable('page_embed_removal_ledger').ifExists().execute();
  await db.schema
    .dropTable('page_embed_attachment_clone_ledger')
    .ifExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('page_embed_graph_fences')
    .ifNotExists()
    .addColumn('workspace_id', 'uuid', (column) =>
      column.primaryKey().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('last_token', 'bigint', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('page_template_legacy_migration_errors')
    .ifNotExists()
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('consumer_page_id', 'uuid', (column) =>
      column.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('source_page_id', 'uuid')
    .addColumn('reference_node_id', 'varchar', (column) => column.notNull())
    .addColumn('error_code', 'varchar', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('page_template_legacy_migration_error_unique', [
      'consumer_page_id',
      'reference_node_id',
    ])
    .execute();

  await sql`
    alter table page_transclusion_references
      drop constraint if exists page_transclusion_references_source_page_id_fkey,
      drop constraint if exists page_transclusion_references_source_page_id_foreign,
      drop constraint if exists page_transclusion_references_unique,
      alter column transclusion_id drop not null,
      add column if not exists reference_kind varchar not null default 'block',
      add column if not exists reference_node_id varchar,
      add constraint page_transclusion_references_kind_check check (
        (reference_kind = 'block' and transclusion_id is not null and reference_node_id is null)
        or
        (reference_kind = 'page' and transclusion_id is null and reference_node_id is not null)
      )
  `.execute(db);
  await sql`
    create unique index if not exists page_transclusion_references_block_unique
      on page_transclusion_references
        (reference_page_id, source_page_id, transclusion_id)
      where reference_kind = 'block';
    create unique index if not exists page_transclusion_references_page_node_unique
      on page_transclusion_references (reference_page_id, reference_node_id)
      where reference_kind = 'page';
    create index if not exists page_transclusion_references_source_kind_idx
      on page_transclusion_references
        (workspace_id, reference_kind, source_page_id);
    create index if not exists page_transclusion_references_consumer_kind_idx
      on page_transclusion_references
        (workspace_id, reference_kind, reference_page_id)
  `.execute(db);

  await sql`
    alter table page_template_operations
      drop constraint if exists page_template_operations_kind_check,
      add column if not exists reference_node_id varchar,
      add column if not exists graph_fencing_token bigint,
      add constraint page_template_operations_kind_check check (
        operation_kind in (
          'snapshot',
          'page_duplicate',
          'embed_insert',
          'embed_detach',
          'template_sync',
          'template_detach',
          'legacy_embed_migration'
        )
      )
  `.execute(db);
  await sql`
    create unique index if not exists page_template_operations_detach_occurrence_pending_unique
      on page_template_operations
        (workspace_id, consumer_page_id, reference_node_id)
      where operation_kind = 'embed_detach' and status = 'pending'
  `.execute(db);
}
