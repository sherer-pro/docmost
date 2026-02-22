import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .addColumn('settings', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .execute();

  await db
    .updateTable('spaces')
    .set({
      settings: sql`COALESCE(settings, '{}'::jsonb)
        || jsonb_build_object(
          'documentFields',
          COALESCE(
            settings->'documentFields',
            '{"status": false, "assignee": false, "stakeholders": false}'::jsonb
          )
        )`,
    })
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('pages').dropColumn('settings').execute();

  await db
    .updateTable('spaces')
    .set({
      settings: sql`settings - 'documentFields'`,
    })
    .execute();
}
