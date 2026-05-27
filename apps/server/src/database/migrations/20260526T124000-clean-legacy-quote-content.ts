import { type Kysely, sql } from 'kysely';

type JsonNode = Record<string, any>;

const LEGACY_QUOTE_PLACEHOLDER =
  'Legacy linked quote was removed during synced block migration.';

function cleanLegacyQuoteNode(input: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(input)) {
    let changed = false;
    const value = input
      .map((item) => {
        const cleaned = cleanLegacyQuoteNode(item);
        changed = changed || cleaned.changed;
        return cleaned.value;
      })
      .filter((item) => item !== null);

    return { value, changed };
  }

  if (!input || typeof input !== 'object') {
    return { value: input, changed: false };
  }

  const node = input as JsonNode;
  if (node.type === 'quoteEmbed') {
    return {
      value: {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: LEGACY_QUOTE_PLACEHOLDER,
          },
        ],
      },
      changed: true,
    };
  }

  let changed = false;
  const next: JsonNode = { ...node };

  if (Array.isArray(node.marks)) {
    const marks = node.marks.filter((mark) => mark?.type !== 'quoteSource');
    if (marks.length !== node.marks.length) {
      changed = true;
      if (marks.length > 0) {
        next.marks = marks;
      } else {
        delete next.marks;
      }
    }
  }

  if (Array.isArray(node.content)) {
    const cleaned = cleanLegacyQuoteNode(node.content);
    if (cleaned.changed) {
      changed = true;
      next.content = cleaned.value;
    }
  }

  return { value: next, changed };
}

export async function up(db: Kysely<any>): Promise<void> {
  const result = await sql<{ id: string; content: unknown }>`
    select id, content
    from pages
    where content::text like '%quoteSource%'
       or content::text like '%quoteEmbed%'
  `.execute(db);

  for (const row of result.rows) {
    const cleaned = cleanLegacyQuoteNode(row.content);
    if (!cleaned.changed) {
      continue;
    }

    await sql`
      update pages
      set content = ${JSON.stringify(cleaned.value)}::jsonb,
          ydoc = null
      where id = ${row.id}
    `.execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Legacy quote marks cannot be reconstructed after cleanup.
}
