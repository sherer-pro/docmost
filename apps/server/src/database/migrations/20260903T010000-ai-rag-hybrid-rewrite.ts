import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('retrieval_query_mode', 'varchar', (col) =>
      col.notNull().defaultTo('vector'),
    )
    .addColumn('retrieval_follow_up_rewrite_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_retrieval_query_mode_check',
      sql`"retrieval_query_mode" in ('vector', 'hybrid_with_vector_fallback')`,
    )
    .execute();

  await db.schema
    .alterTable('ai_runs')
    .addColumn('retrieval_query', 'text')
    .addColumn('retrieval_rewrite_outcome', 'varchar', (col) =>
      col.notNull().defaultTo('not_requested'),
    )
    .addColumn('retrieval_rewrite_error_code', 'varchar')
    .addColumn('retrieval_rewrite_latency_ms', 'integer')
    .addColumn('retrieval_rewrite_input_tokens', 'bigint', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('retrieval_rewrite_output_tokens', 'bigint', (col) =>
      col.notNull().defaultTo(0),
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_retrieval_rewrite_outcome_check',
      sql`"retrieval_rewrite_outcome" in ('not_requested', 'disabled', 'rewritten', 'unchanged', 'failed')`,
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_retrieval_rewrite_latency_check',
      sql`"retrieval_rewrite_latency_ms" is null or "retrieval_rewrite_latency_ms" >= 0`,
    )
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .addCheckConstraint(
      'ai_runs_retrieval_rewrite_tokens_check',
      sql`"retrieval_rewrite_input_tokens" >= 0 and "retrieval_rewrite_output_tokens" >= 0`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_retrieval_rewrite_tokens_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_retrieval_rewrite_latency_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropConstraint('ai_runs_retrieval_rewrite_outcome_check')
    .execute();
  await db.schema
    .alterTable('ai_runs')
    .dropColumn('retrieval_rewrite_output_tokens')
    .dropColumn('retrieval_rewrite_input_tokens')
    .dropColumn('retrieval_rewrite_latency_ms')
    .dropColumn('retrieval_rewrite_error_code')
    .dropColumn('retrieval_rewrite_outcome')
    .dropColumn('retrieval_query')
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_retrieval_query_mode_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('retrieval_follow_up_rewrite_enabled')
    .dropColumn('retrieval_query_mode')
    .execute();
}
