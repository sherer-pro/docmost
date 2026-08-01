import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    WITH ranked_shares AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY page_id
               ORDER BY created_at ASC, id ASC
             ) AS duplicate_rank
      FROM shares
      WHERE page_id IS NOT NULL
    )
    DELETE FROM shares AS share
    USING ranked_shares AS ranked
    WHERE share.id = ranked.id
      AND ranked.duplicate_rank > 1
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX shares_page_id_unique
    ON shares (page_id)
    WHERE page_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('shares_page_id_unique').ifExists().execute();
}
