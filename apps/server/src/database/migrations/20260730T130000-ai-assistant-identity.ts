import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('assistant_name_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('assistant_name', 'varchar(80)')
    .addColumn('assistant_gender', 'varchar', (col) =>
      col.notNull().defaultTo('masculine'),
    )
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_assistant_gender_check',
      sql`"assistant_gender" in ('masculine', 'feminine')`,
    )
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_assistant_name_check',
      sql`
        not "assistant_name_enabled"
        or (
          "assistant_name" is not null
          and length(btrim("assistant_name")) between 1 and 80
        )
      `,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_assistant_name_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_assistant_gender_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('assistant_gender')
    .dropColumn('assistant_name')
    .dropColumn('assistant_name_enabled')
    .execute();
}
