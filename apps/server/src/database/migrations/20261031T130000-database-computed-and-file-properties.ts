import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`create or replace function normalize_database_cell_value(input jsonb, property_type text)
    returns jsonb language plpgsql immutable parallel safe as $$
    declare current_value jsonb := input; parsed jsonb;
    begin
      if current_value ? 'rawValueBeforeTypeChange' then current_value := current_value -> 'value'; end if;
      for iteration in 1..6 loop
        exit when jsonb_typeof(current_value) is distinct from 'string';
        begin parsed := (current_value #>> '{}')::jsonb;
        exception when invalid_text_representation then exit;
        end;
        if jsonb_typeof(parsed) = 'string'
          or (property_type in ('user', 'page_reference', 'select', 'date') and jsonb_typeof(parsed) = 'object')
          or (property_type in ('user', 'multi_select', 'file') and jsonb_typeof(parsed) = 'array')
          or (property_type = 'checkbox' and jsonb_typeof(parsed) = 'boolean')
          or (property_type = 'number' and jsonb_typeof(parsed) = 'number') then
          current_value := parsed;
        else exit;
        end if;
      end loop;
      return current_value;
    end $$`.execute(db);
  await sql`update database_rows r set updated_at = c.updated_at, updated_by_id = c.updated_by_id
    from (select distinct on (database_id, page_id) database_id, page_id, updated_at, updated_by_id
      from database_cells order by database_id, page_id, updated_at desc, id desc) c
    where r.database_id = c.database_id and r.page_id = c.page_id and c.updated_at > r.updated_at`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  const used =
    await sql`select 1 from database_properties where type in ('formula', 'file', 'created_at', 'updated_at', 'updated_by') limit 1`.execute(
      db,
    );
  if (used.rows.length)
    throw new Error(
      'Computed or file properties exist; disable creation instead of downgrading',
    );
  const participants =
    await sql`select 1 from database_cells c inner join database_properties p on p.id = c.property_id where p.type = 'user' and jsonb_typeof(normalize_database_cell_value(c.value, 'user')) = 'array' limit 1`.execute(
      db,
    );
  if (participants.rows.length)
    throw new Error(
      'Multiple participants exist; an older client is not a compatible downgrade',
    );
  // The backward-compatible adapter and corrected row metadata are retained.
}
