import { Kysely, sql } from 'kysely';

/**
 * Adds a canonical JSON field for the rich description of the database.
 *
 * We are keeping the old plain-text `description` for backwards compatibility,
 * and we use the new `description_content` as the main source for rich UX.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('databases')
    .addColumn('description_content', 'jsonb', (col) => col)
    .execute();

  await sql`
    UPDATE databases
    SET description_content = jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'paragraph',
          'content', CASE
            WHEN description IS NULL OR btrim(description) = '' THEN '[]'::jsonb
            ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', description))
          END
        )
      )
    )
    WHERE description IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('databases')
    .dropColumn('description_content')
    .execute();
}
