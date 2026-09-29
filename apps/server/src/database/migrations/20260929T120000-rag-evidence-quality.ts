import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('retrieval_quality_profile', 'varchar', (col) =>
      col.notNull().defaultTo('legacy-v1'),
    )
    .addColumn('retrieval_query_expansion_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_retrieval_quality_profile_check',
      sql`retrieval_quality_profile in ('legacy-v1', 'evidence-v1')`,
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addColumn('retrieval_diagnostics', 'jsonb')
    .addColumn('evidence_snapshot', 'jsonb')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('evidence_snapshot')
    .dropColumn('retrieval_diagnostics')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_retrieval_quality_profile_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('retrieval_quality_profile')
    .dropColumn('retrieval_query_expansion_enabled')
    .execute();
}
