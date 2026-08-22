import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('attachment_cleanup_batches')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) => col.notNull())
    .addColumn('scope_type', 'text', (col) => col.notNull())
    .addColumn('scope_id', 'uuid', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('item_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('completed_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('failed_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('lease_token', 'uuid')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('attachment_cleanup_batches_scope_unique', [
      'scope_type',
      'scope_id',
    ])
    .addCheckConstraint(
      'attachment_cleanup_batches_status_check',
      sql`status in ('pending', 'processing', 'completed', 'failed')`,
    )
    .execute();

  await db.schema
    .createTable('attachment_cleanup_items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('batch_id', 'uuid', (col) =>
      col
        .notNull()
        .references('attachment_cleanup_batches.id')
        .onDelete('cascade'),
    )
    .addColumn('attachment_id', 'uuid', (col) => col.notNull())
    .addColumn('file_path', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lease_token', 'uuid')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('last_error_code', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('attachment_cleanup_items_batch_attachment_unique', [
      'batch_id',
      'attachment_id',
    ])
    .addCheckConstraint(
      'attachment_cleanup_items_status_check',
      sql`status in ('pending', 'processing', 'completed', 'failed')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_attachment_cleanup_items_claim')
    .on('attachment_cleanup_items')
    .columns(['batch_id', 'status', 'lease_expires_at'])
    .execute();

  await db.schema
    .alterTable('file_tasks')
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lease_token', 'uuid')
    .addColumn('lease_expires_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_file_tasks_import_claim')
    .on('file_tasks')
    .columns(['type', 'source', 'status', 'lease_expires_at'])
    .execute();

  await db.schema
    .createTable('file_task_import_pages')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('file_task_id', 'uuid', (col) =>
      col.notNull().references('file_tasks.id').onDelete('cascade'),
    )
    .addColumn('source_path', 'text', (col) => col.notNull())
    .addColumn('page_id', 'uuid', (col) => col.notNull())
    .addColumn('slug_id', 'varchar', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('file_task_import_pages_source_unique', [
      'file_task_id',
      'source_path',
    ])
    .addUniqueConstraint('file_task_import_pages_page_unique', ['page_id'])
    .addCheckConstraint(
      'file_task_import_pages_status_check',
      sql`status in ('pending', 'completed')`,
    )
    .execute();

  await db.schema
    .createTable('file_task_import_artifacts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('file_task_id', 'uuid', (col) =>
      col.notNull().references('file_tasks.id').onDelete('cascade'),
    )
    .addColumn('artifact_type', 'text', (col) =>
      col.notNull().defaultTo('attachment'),
    )
    .addColumn('attachment_id', 'uuid')
    .addColumn('page_id', 'uuid')
    .addColumn('source_path', 'text', (col) => col.notNull())
    .addColumn('file_path', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('file_task_import_artifacts_source_unique', [
      'file_task_id',
      'page_id',
      'source_path',
    ])
    .addUniqueConstraint('file_task_import_artifacts_attachment_unique', [
      'attachment_id',
    ])
    .addCheckConstraint(
      'file_task_import_artifacts_status_check',
      sql`status in ('pending', 'uploaded', 'attached', 'cleaned')`,
    )
    .addCheckConstraint(
      'file_task_import_artifacts_type_check',
      sql`(
        artifact_type = 'archive'
        and attachment_id is null
        and page_id is null
      ) or (
        artifact_type = 'attachment'
        and attachment_id is not null
        and page_id is not null
      )`,
    )
    .execute();

  await sql`
    create unique index file_task_import_artifacts_archive_unique
      on file_task_import_artifacts (file_task_id)
      where artifact_type = 'archive'
  `.execute(db);

  await sql`
    alter table queue_outbox
      drop constraint if exists queue_outbox_kind_check,
      add constraint queue_outbox_kind_check check (
        kind in (
          'workspace_invitation_email',
          'workspace_invitation_accepted_email',
          'duplicate_page_attachments',
          'page_template_sync',
          'notification_email',
          'notification_dispatch',
          'attachment_cleanup',
          'file_import'
        )
      )
  `.execute(db);

  // Imports created by the previous release may have lost their non-durable
  // BullMQ delivery. Record the uploaded archive before re-enqueueing it so a
  // terminal failure retains enough information for storage compensation.
  await sql`
    insert into file_task_import_artifacts (
      file_task_id,
      artifact_type,
      source_path,
      file_path,
      status
    )
    select
      id,
      'archive',
      file_name,
      file_path,
      'uploaded'
    from file_tasks
    where type = 'import'
      and source in ('generic', 'notion', 'docmost')
      and status in ('uploading', 'pending', 'processing', 'success', 'failed')
    on conflict do nothing
  `.execute(db);

  await sql`
    update file_tasks
    set
      status = 'pending',
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where type = 'import'
      and source in ('generic', 'notion', 'docmost')
      and status = 'processing'
  `.execute(db);
  await sql`
    insert into queue_outbox (kind, payload, dedupe_key, status)
    select
      'file_import',
      jsonb_build_object('fileTaskId', id),
      'file-import:' || id::text,
      'pending'
    from file_tasks
    where type = 'import'
      and source in ('generic', 'notion', 'docmost')
      and (
        status = 'success'
        or (
          status = 'pending'
          and (source != 'docmost' or options is not null)
        )
      )
    on conflict (dedupe_key) do nothing
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1
        from attachment_cleanup_batches
        where status != 'completed'
      ) then
        raise exception using
          errcode = '55000',
          message = 'durable deletion rollback blocked: attachment cleanup is not drained';
      end if;

      if exists (
        select 1
        from file_tasks task
        where task.type = 'import'
          and task.status in ('uploading', 'pending', 'processing')
          and (
            exists (
              select 1
              from file_task_import_artifacts artifact
              where artifact.file_task_id = task.id
            )
            or exists (
              select 1
              from queue_outbox outbox
              where outbox.kind = 'file_import'
                and outbox.dedupe_key = 'file-import:' || task.id::text
            )
          )
      ) then
        raise exception using
          errcode = '55000',
          message = 'durable import rollback blocked: active imports are not drained';
      end if;

      if exists (
        select 1
        from file_task_import_artifacts
        where status in ('pending', 'uploaded')
      ) then
        raise exception using
          errcode = '55000',
          message = 'durable import rollback blocked: storage artifacts are not compensated';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    delete from queue_outbox
    where kind in ('attachment_cleanup', 'file_import')
  `.execute(db);
  await sql`
    alter table queue_outbox
      drop constraint if exists queue_outbox_kind_check,
      add constraint queue_outbox_kind_check check (
        kind in (
          'workspace_invitation_email',
          'workspace_invitation_accepted_email',
          'duplicate_page_attachments',
          'page_template_sync',
          'notification_email',
          'notification_dispatch'
        )
      )
  `.execute(db);

  await db.schema.dropTable('file_task_import_artifacts').execute();
  await db.schema.dropTable('file_task_import_pages').execute();
  await db.schema.dropIndex('idx_file_tasks_import_claim').execute();
  await db.schema
    .alterTable('file_tasks')
    .dropColumn('lease_expires_at')
    .dropColumn('lease_token')
    .dropColumn('attempt_count')
    .execute();
  await db.schema.dropTable('attachment_cleanup_items').execute();
  await db.schema.dropTable('attachment_cleanup_batches').execute();
}
