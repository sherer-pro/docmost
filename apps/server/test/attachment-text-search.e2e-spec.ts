import { randomUUID } from 'node:crypto';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from '../src/database/postgres-client';
import { AttachmentContentService } from '../src/core/attachment/services/attachment-content.service';
import { up as vectorUp } from '../src/database/migrations/20260730T160000-attachment-content-search-vector';
import {
  up,
  down,
} from '../src/database/migrations/20261101T000000-plain-text-attachment-search';

const databaseUrl = process.env.DATABASE_TABLES_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('Plain-text attachment PostgreSQL acceptance', () => {
  let db: Kysely<any>;
  const schema = `attachment_text_${randomUUID().replace(/-/g, '')}`;
  const text = '# Terms\n\nMinimum contract: 6 months.';
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    ) {
      throw new Error('A dedicated local test database is required');
    }
    db = new Kysely<any>({
      dialect: new PostgresJSDialect({
        postgres: postgres(databaseUrl!, {
          max: 1,
          onnotice: () => {},
          connection: { search_path: schema },
        }),
      }),
      plugins: [new CamelCasePlugin()],
    });
    await db.schema.createSchema(schema).execute();
    await sql`create function f_unaccent(text) returns text language sql immutable as 'select $1'`.execute(
      db,
    );
    await sql`create table attachments (
      id uuid primary key, file_name text, file_ext text, file_path text,
      file_size bigint, deleted_at timestamptz, text_content text, tsv tsvector,
      content_index_status text, content_index_error text,
      content_index_started_at timestamptz, content_indexed_at timestamptz,
      content_index_version integer
    )`.execute(db);
    await vectorUp(db);
  });

  afterAll(async () => {
    if (db) {
      try {
        await db.schema.dropSchema(schema).cascade().execute();
      } finally {
        await db.destroy();
      }
    }
  });

  it('backfills eligible old text only and preserves claims, terminal failures and extracted data on rollback', async () => {
    const fixtures = [
      { ext: '.md', status: null, error: null, expected: 'pending' },
      {
        ext: '.TXT',
        status: 'skipped',
        error: 'unsupported_type',
        expected: 'pending',
      },
      {
        ext: '.txt',
        status: 'processing',
        error: null,
        expected: 'processing',
      },
      { ext: '.md', status: 'ready', error: null, expected: 'ready' },
      {
        ext: '.txt',
        status: 'skipped',
        error: 'file_too_large',
        expected: 'skipped',
      },
      {
        ext: '.txt',
        status: 'failed',
        error: 'bad_content',
        expected: 'failed',
      },
      { ext: '.bin', status: null, error: null, expected: null },
      { ext: '.txt', status: null, error: null, expected: null, deleted: true },
    ];
    const ids: string[] = [];
    for (const fixture of fixtures) {
      const id = randomUUID();
      ids.push(id);
      await db
        .insertInto('attachments')
        .values({
          id,
          fileExt: fixture.ext,
          fileName: `${id}${fixture.ext}`,
          filePath: id,
          contentIndexStatus: fixture.status,
          contentIndexError: fixture.error,
          textContent: 'retained',
          deletedAt: fixture.deleted ? new Date() : null,
        })
        .execute();
    }
    await up(db);
    await up(db);
    const before = await db
      .selectFrom('attachments')
      .selectAll()
      .where('id', 'in', ids)
      .orderBy('id')
      .execute();
    fixtures.forEach((fixture, index) => {
      const row = before.find((item) => item.id === ids[index]);
      expect(row?.contentIndexStatus).toBe(fixture.expected);
      expect(row?.textContent).toBe('retained');
    });
    await down(db);
    expect(
      await db
        .selectFrom('attachments')
        .selectAll()
        .where('id', 'in', ids)
        .orderBy('id')
        .execute(),
    ).toEqual(before);
  });

  it.each(['.md', '.txt'])(
    'indexes %s bytes under an opaque filename through the fenced worker and search trigger',
    async (fileExt) => {
      const id = randomUUID();
      const buffer = Buffer.from(text);
      await db
        .insertInto('attachments')
        .values({
          id,
          fileName: `${id}${fileExt}`,
          fileExt,
          filePath: id,
          fileSize: buffer.length,
          contentIndexStatus: 'pending',
        })
        .execute();
      const service = new AttachmentContentService(
        {
          exists: jest.fn().mockResolvedValue(true),
          read: jest.fn().mockResolvedValue(buffer),
        } as any,
        db as any,
        queue as any,
        queue as any,
      );

      await service.indexAttachment(id);

      const stored = await db
        .selectFrom('attachments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(stored.contentIndexStatus).toBe('ready');
      expect(stored.contentIndexStartedAt).toBeNull();
      expect(stored.textContent).toBe(text);
      const match = await sql<{ id: string }>`select id from attachments
      where id = ${id} and tsv @@ plainto_tsquery('english', 'contract')`.execute(
        db,
      );
      expect(match.rows).toEqual([{ id }]);
      expect(queue.add).toHaveBeenCalledWith(
        'search-index-attachment',
        { attachmentIds: [id] },
        expect.any(Object),
      );
    },
  );
});
