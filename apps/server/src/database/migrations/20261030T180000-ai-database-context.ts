import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_runs')
    .addColumn('database_context', 'jsonb')
    .execute();
  for (const table of [
    'ai_builtin_tool_workspace_policies',
    'ai_builtin_tool_space_policies',
  ]) {
    await db.schema
      .alterTable(table)
      .addColumn('read_only', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('knowledge_only', 'boolean', (c) =>
        c.notNull().defaultTo(false),
      )
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of [
    'ai_builtin_tool_workspace_policies',
    'ai_builtin_tool_space_policies',
  ]) {
    await db.schema
      .alterTable(table)
      .dropColumn('read_only')
      .dropColumn('knowledge_only')
      .execute();
  }
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('database_context')
    .execute();
}
