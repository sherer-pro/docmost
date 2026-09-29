import { randomUUID } from 'node:crypto';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from '../src/database/postgres-client';
import {
  up,
  down,
} from '../src/database/migrations/20260929T120000-rag-evidence-quality';

const databaseUrl = process.env.RAG_QUALITY_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('RAG evidence quality migration on PostgreSQL', () => {
  let db: Kysely<any>;
  const schema = `rag_quality_${randomUUID().replace(/-/g, '')}`;
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    ) {
      throw new Error('A dedicated local test database is required');
    }
    db = new Kysely({
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
    await sql`create table ai_space_configs (id text primary key)`.execute(db);
    await sql`create table ai_runs (id text primary key, content text)`.execute(
      db,
    );
    await db
      .insertInto('aiSpaceConfigs')
      .values({ id: 'existing-space' })
      .execute();
    await db
      .insertInto('aiRuns')
      .values({ id: 'existing-run', content: 'Retained answer' })
      .execute();
  });
  afterAll(async () => {
    if (db) {
      try {
        await db.schema.dropSchema(schema).ifExists().cascade().execute();
      } finally {
        await db.destroy();
      }
    }
  });

  it('backfills safe defaults, constrains profiles and preserves runs across rollback', async () => {
    await up(db);
    expect(
      await db.selectFrom('aiSpaceConfigs').selectAll().executeTakeFirst(),
    ).toMatchObject({
      retrievalQualityProfile: 'legacy-v1',
      retrievalQueryExpansionEnabled: false,
    });
    await expect(
      db
        .updateTable('aiSpaceConfigs')
        .set({ retrievalQualityProfile: 'unknown' })
        .execute(),
    ).rejects.toThrow();
    await db
      .updateTable('aiSpaceConfigs')
      .set({ retrievalQualityProfile: 'evidence-v1' })
      .execute();
    const snapshot = {
      schemaVersion: 1,
      sources: [
        { sourceId: 'page', version: 'current', excerpt: '200', marker: 'S1' },
      ],
    };
    await db
      .updateTable('aiRuns')
      .set({
        evidenceSnapshot: snapshot,
        retrievalDiagnostics: { admitted: 1, cited: 1 },
      })
      .execute();
    expect(
      await db.selectFrom('aiRuns').selectAll().executeTakeFirst(),
    ).toMatchObject({ evidenceSnapshot: snapshot });
    await down(db);
    expect(
      await db.selectFrom('aiRuns').selectAll().executeTakeFirst(),
    ).toEqual({ id: 'existing-run', content: 'Retained answer' });
    await up(db);
    expect(
      await db.selectFrom('aiRuns').selectAll().executeTakeFirst(),
    ).toMatchObject({ evidenceSnapshot: null, retrievalDiagnostics: null });
  });
});
