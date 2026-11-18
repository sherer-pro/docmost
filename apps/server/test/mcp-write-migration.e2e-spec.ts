import { randomUUID } from 'node:crypto';
import { Kysely, Migrator, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from '../src/database/postgres-client';
import * as migration from '../src/database/migrations/20261118T000000-mcp-write-operations';
import {
  MCP_WRITE_CAPABILITIES,
  MCP_WRITE_COMPANION_READ_CAPABILITIES,
} from '@docmost/api-contract';

const databaseUrl = process.env.DATABASE_TABLES_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('MCP API key write migration', () => {
  it('expands legacy MCP keys once and rolls back while retaining later key narrowing', async () => {
    const target = new URL(databaseUrl!);
    if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test')) {
      throw new Error('A dedicated local test database is required');
    }
    const schema = `mcp_write_${randomUUID().replaceAll('-', '')}`;
    const db = new Kysely<any>({
      dialect: new PostgresJSDialect({
        postgres: postgres(databaseUrl!, {
          max: 1,
          onnotice: () => {},
          connection: { search_path: schema },
        }),
      }),
    });
    const migrate = new Migrator({
      db,
      migrationTableSchema: schema,
      provider: { getMigrations: async () => ({ mcp_write: migration }) },
    });
    const untouched = randomUUID();
    const edited = randomUUID();
    const rag = randomUUID();
    const oauth = randomUUID();
    const old = ['page.node.read', 'page.comments.read'];
    const narrowed = ['page.content.read'];
    const writeList = () => db.selectFrom('api_keys').selectAll().execute();
    try {
      await db.schema.createSchema(schema).execute();
      await sql`create table api_keys (id uuid primary key, key_type text not null, allowed_capabilities jsonb)`.execute(
        db,
      );
      await sql`create table queue_outbox (kind text not null)`.execute(db);
      for (const table of [
        'ai_builtin_tool_workspace_policies',
        'ai_builtin_tool_space_policies',
        'mcp_oauth_grants',
      ]) {
        await sql`create table ${sql.table(table)} (id uuid primary key, allowed_capabilities jsonb)`.execute(
          db,
        );
      }
      for (const id of [untouched, edited]) {
        await sql`insert into api_keys values (${id}, 'mcp', ${JSON.stringify(old)}::text::jsonb)`.execute(
          db,
        );
      }
      await sql`insert into api_keys values (${rag}, 'rag', null)`.execute(db);
      await sql`insert into mcp_oauth_grants values (${oauth}, ${JSON.stringify(old)}::text::jsonb)`.execute(
        db,
      );
      expect((await migrate.migrateToLatest()).error).toBeUndefined();
      expect(await writeList()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: untouched,
            allowed_capabilities: [
              ...old,
              ...MCP_WRITE_CAPABILITIES,
              MCP_WRITE_COMPANION_READ_CAPABILITIES[1],
            ],
          }),
          expect.objectContaining({ id: rag, allowed_capabilities: null }),
        ]),
      );
      await sql`update api_keys set allowed_capabilities = ${JSON.stringify(narrowed)}::text::jsonb where id = ${edited}`.execute(
        db,
      );
      expect((await migrate.migrateToLatest()).error).toBeUndefined();
      expect(
        (await writeList()).find((key) => key.id === edited)
          ?.allowed_capabilities,
      ).toEqual(narrowed);
      expect((await migrate.migrateDown()).error).toBeUndefined();
      expect(await writeList()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: untouched, allowed_capabilities: old }),
          expect.objectContaining({
            id: edited,
            allowed_capabilities: narrowed,
          }),
          expect.objectContaining({ id: rag, allowed_capabilities: null }),
        ]),
      );
      expect(
        (await db.selectFrom('mcp_oauth_grants').selectAll().executeTakeFirst())
          ?.allowed_capabilities,
      ).toEqual(old);
    } finally {
      try {
        await db.schema.dropSchema(schema).cascade().execute();
      } finally {
        await db.destroy();
      }
    }
  });
});
