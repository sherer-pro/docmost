import { type Kysely, sql } from 'kysely';
import {
  cleanMalformedLeadingTableRows,
  parseJsonContent,
} from './20260608T121000-repair-stringified-page-content';

export async function up(db: Kysely<any>): Promise<void> {
  const result = await sql<{ id: string; content: unknown }>`
    select id, content
    from pages
    where jsonb_typeof(content) = 'string'
  `.execute(db);

  for (const row of result.rows) {
    const parsed = parseJsonContent(row.content);
    const cleaned = cleanMalformedLeadingTableRows(parsed);

    await sql`
      update pages
      set content = ${sql.lit(JSON.stringify(cleaned.value))}::jsonb,
          ydoc = null
      where id = ${row.id}
    `.execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // JSONB strings are invalid page content and cannot be restored safely.
}
