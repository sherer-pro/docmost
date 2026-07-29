import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('reasoning_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();

  await db.schema
    .alterTable('ai_messages')
    .addColumn('reasoning', 'text', (col) => col.notNull().defaultTo(''))
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addColumn('reasoning_snapshot', 'text')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('reasoning_snapshot')
    .execute();

  await db.schema.alterTable('ai_messages').dropColumn('reasoning').execute();

  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('reasoning_enabled')
    .execute();
}
