import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    update workspaces
    set settings = jsonb_set(
      settings,
      '{tags,disabled}',
      (settings #>> '{tags,disabled}')::jsonb,
      true
    )
    where jsonb_typeof(settings #> '{tags,disabled}') = 'string'
      and (settings #>> '{tags,disabled}') is json array
  `.execute(db);

  await sql`
    update workspaces
    set settings = jsonb_set(
      settings,
      '{sharing,disabled}',
      to_jsonb((settings #>> '{sharing,disabled}')::boolean),
      true
    )
    where jsonb_typeof(settings #> '{sharing,disabled}') = 'string'
      and lower(settings #>> '{sharing,disabled}') in ('true', 'false')
  `.execute(db);

  await sql`
    update workspaces
    set settings = jsonb_set(
      settings,
      '{api,restrictToAdmins}',
      to_jsonb((settings #>> '{api,restrictToAdmins}')::boolean),
      true
    )
    where jsonb_typeof(settings #> '{api,restrictToAdmins}') = 'string'
      and lower(settings #>> '{api,restrictToAdmins}') in ('true', 'false')
  `.execute(db);
}

export async function down(): Promise<void> {
  // Normalized values cannot be distinguished from settings that were already valid.
}
