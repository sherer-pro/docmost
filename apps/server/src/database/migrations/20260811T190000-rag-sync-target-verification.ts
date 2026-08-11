import { Kysely } from 'kysely';

/**
 * Records the most recent successful writer probe for the current target.
 * Existing bindings remain unverified because historical probe success cannot
 * be reconstructed safely. Running bindings continue until they are disabled;
 * a later enable requires a fresh target test.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('rag_sync_bindings')
    .addColumn('last_tested_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('rag_sync_bindings')
    .dropColumn('last_tested_at')
    .execute();
}
