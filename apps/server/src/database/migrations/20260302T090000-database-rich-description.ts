import { Kysely, sql } from 'kysely';

/**
 * Добавляет canonical JSON-поле для rich description базы.
 *
 * Мы сохраняем старый plain-text `description` для обратной совместимости,
 * а новый `description_content` используем как основной источник для rich UX.
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
