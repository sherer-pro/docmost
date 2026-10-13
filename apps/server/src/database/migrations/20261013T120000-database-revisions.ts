import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('database_cells')
    .addColumn('revision', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
  await db.schema
    .alterTable('database_views')
    .addColumn('revision', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
  await sql`create function normalize_database_cell_value(input jsonb, property_type text)
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
          or (property_type = 'multi_select' and jsonb_typeof(parsed) = 'array')
          or (property_type = 'checkbox' and jsonb_typeof(parsed) = 'boolean')
          or (property_type = 'number' and jsonb_typeof(parsed) = 'number') then
          current_value := parsed;
        else exit;
        end if;
      end loop;
      return current_value;
    end $$`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop function normalize_database_cell_value(jsonb, text)`.execute(
    db,
  );
  await db.schema.alterTable('database_views').dropColumn('revision').execute();
  await db.schema.alterTable('database_cells').dropColumn('revision').execute();
}
