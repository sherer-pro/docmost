import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('labels')
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade'),
    )
    .execute();

  await db.schema
    .dropIndex('labels_workspace_id_type_name_unique')
    .ifExists()
    .execute();

  await sql`
    delete from labels l
    where not exists (
      select 1
      from page_labels pl
      where pl.label_id = l.id
    )
  `.execute(db);

  await sql`
    with label_primary_spaces as (
      select
        pl.label_id,
        min(p.space_id::text)::uuid as space_id
      from page_labels pl
      inner join pages p on p.id = pl.page_id
      group by pl.label_id
    )
    update labels l
    set space_id = label_primary_spaces.space_id
    from label_primary_spaces
    where l.id = label_primary_spaces.label_id
  `.execute(db);

  await sql`
    with label_space_pairs as (
      select distinct
        l.id as original_label_id,
        l.name,
        l.type,
        l.workspace_id,
        p.space_id,
        l.space_id as primary_space_id
      from labels l
      inner join page_labels pl on pl.label_id = l.id
      inner join pages p on p.id = pl.page_id
    )
    insert into labels (name, type, workspace_id, space_id, created_at, updated_at)
    select
      name,
      type,
      workspace_id,
      space_id,
      now(),
      now()
    from label_space_pairs
    where space_id <> primary_space_id
  `.execute(db);

  await sql`
    update page_labels pl
    set label_id = replacement.id
    from pages p, labels original, labels replacement
    where p.id = pl.page_id
      and original.id = pl.label_id
      and original.space_id <> p.space_id
      and replacement.workspace_id = original.workspace_id
      and replacement.type = original.type
      and replacement.name = original.name
      and replacement.space_id = p.space_id
  `.execute(db);

  await sql`
    delete from labels l
    where l.space_id is null
      or not exists (
        select 1
        from page_labels pl
        where pl.label_id = l.id
      )
  `.execute(db);

  await db.schema
    .alterTable('labels')
    .alterColumn('space_id', (col) => col.setNotNull())
    .execute();

  await db.schema
    .createIndex('labels_workspace_id_space_id_type_name_unique')
    .on('labels')
    .columns(['workspace_id', 'space_id', 'type', 'name'])
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('labels_workspace_id_space_id_type_name_unique')
    .ifExists()
    .execute();

  await sql`
    with canonical_labels as (
      select
        id,
        first_value(id) over (
          partition by workspace_id, type, name
          order by created_at asc, id asc
        ) as canonical_id
      from labels
    )
    delete from page_labels pl
    using canonical_labels c, page_labels existing
    where pl.label_id = c.id
      and c.id <> c.canonical_id
      and existing.page_id = pl.page_id
      and existing.label_id = c.canonical_id
  `.execute(db);

  await sql`
    with canonical_labels as (
      select
        id,
        first_value(id) over (
          partition by workspace_id, type, name
          order by created_at asc, id asc
        ) as canonical_id
      from labels
    )
    update page_labels pl
    set label_id = c.canonical_id
    from canonical_labels c
    where pl.label_id = c.id
      and c.id <> c.canonical_id
  `.execute(db);

  await sql`
    with canonical_labels as (
      select
        id,
        first_value(id) over (
          partition by workspace_id, type, name
          order by created_at asc, id asc
        ) as canonical_id
      from labels
    )
    delete from labels l
    using canonical_labels c
    where l.id = c.id
      and c.id <> c.canonical_id
  `.execute(db);

  await db.schema.alterTable('labels').dropColumn('space_id').execute();

  await db.schema
    .createIndex('labels_workspace_id_type_name_unique')
    .on('labels')
    .columns(['workspace_id', 'type', 'name'])
    .unique()
    .execute();
}
