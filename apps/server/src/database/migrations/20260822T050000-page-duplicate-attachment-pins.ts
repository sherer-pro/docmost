import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('page_duplicate_attachment_pins')
    .addColumn('outbox_id', 'uuid', (col) =>
      col
        .notNull()
        .references('queue_outbox.id')
        .onDelete('cascade'),
    )
    .addColumn('source_attachment_id', 'uuid', (col) =>
      col
        .notNull()
        .references('attachments.id')
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('page_duplicate_attachment_pins_pkey', [
      'outbox_id',
      'source_attachment_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_page_duplicate_attachment_pins_source')
    .on('page_duplicate_attachment_pins')
    .column('source_attachment_id')
    .execute();

  await sql`
    create function release_page_duplicate_attachment_pins_on_terminal()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.kind = 'duplicate_page_attachments'
        and new.status in ('completed', 'cancelled')
        and old.status is distinct from new.status
      then
        delete from page_duplicate_attachment_pins
        where outbox_id = new.id;
      end if;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger queue_outbox_release_duplicate_attachment_pins
    after update of status on queue_outbox
    for each row
    execute function release_page_duplicate_attachment_pins_on_terminal()
  `.execute(db);

  await sql`
    with active_outbox as materialized (
      select id, payload
      from queue_outbox
      where kind = 'duplicate_page_attachments'
        and status in ('pending', 'processing', 'failed')
      for update
    )
    insert into page_duplicate_attachment_pins (
      outbox_id,
      source_attachment_id
    )
    select distinct
      outbox.id,
      attachment.id
    from active_outbox outbox
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(outbox.payload -> 'attachmentMappings') = 'array'
          then outbox.payload -> 'attachmentMappings'
        else '[]'::jsonb
      end
    ) mapping
    join attachments attachment
      on attachment.id::text = mapping ->> 'oldAttachmentId'
      and attachment.deleted_at is null
    on conflict do nothing
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (
        select 1
        from queue_outbox outbox
        where outbox.kind = 'duplicate_page_attachments'
          and outbox.status in ('pending', 'processing', 'failed')
          and jsonb_typeof(outbox.payload -> 'attachmentMappings') is distinct from 'array'
      ) then
        raise exception using
          errcode = '55000',
          message = 'page duplicate attachment pin migration blocked: invalid active outbox payload';
      end if;

      if exists (
        select 1
        from queue_outbox outbox
        cross join lateral jsonb_array_elements(
          case
            when outbox.kind = 'duplicate_page_attachments'
              and outbox.status in ('pending', 'processing', 'failed')
              and jsonb_typeof(outbox.payload -> 'attachmentMappings') = 'array'
              then outbox.payload -> 'attachmentMappings'
            else '[]'::jsonb
          end
        ) mapping
        left join page_duplicate_attachment_pins pin
          on pin.outbox_id = outbox.id
          and pin.source_attachment_id::text = mapping ->> 'oldAttachmentId'
        where outbox.kind = 'duplicate_page_attachments'
          and outbox.status in ('pending', 'processing', 'failed')
          and pin.source_attachment_id is null
      ) then
        raise exception using
          errcode = '55000',
          message = 'page duplicate attachment pin migration blocked: source attachment is unavailable';
      end if;
    end
    $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1
        from queue_outbox
        where kind = 'duplicate_page_attachments'
          and status in ('pending', 'processing', 'failed')
      ) or exists (
        select 1
        from page_duplicate_attachment_pins
      ) then
        raise exception using
          errcode = '55000',
          message = 'page duplicate attachment pin rollback blocked: duplicate attachment work is not drained';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    drop trigger queue_outbox_release_duplicate_attachment_pins
      on queue_outbox
  `.execute(db);
  await sql`
    drop function release_page_duplicate_attachment_pins_on_terminal()
  `.execute(db);
  await db.schema.dropTable('page_duplicate_attachment_pins').execute();
}
