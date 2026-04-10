jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { RagService } from './rag.service';

class TestPostgresDialect {
  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return new DummyDriver();
  }

  createIntrospector(db: Kysely<any>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

describe('RagService getUpdates SQL generation', () => {
  let queries: string[] = [];

  const db = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
    plugins: [new CamelCasePlugin()],
    log: (event) => {
      if (event.level === 'query') {
        queries.push(event.query.sql);
      }
    },
  });

  const service = new RagService(
    db as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const scope = {
    user: { id: 'user-1' },
    workspace: { id: 'workspace-1' },
    space: { id: 'space-1', settings: {} },
  } as any;

  beforeEach(() => {
    queries = [];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('uses snake_case identifiers in updates aggregation SQL', async () => {
    await expect(service.getUpdates(scope, 0)).resolves.toEqual({
      items: [],
      maxUpdatedAtMs: 0,
    });

    const aggregationQuery = queries.find((query) => query.includes('GREATEST('));

    expect(aggregationQuery).toBeDefined();
    expect(aggregationQuery).toContain('"databases"."updated_at"');
    expect(aggregationQuery).toContain('"database_pages"."updated_at"');
    expect(aggregationQuery).toContain(
      '"properties_changes"."properties_updated_at"',
    );
    expect(aggregationQuery).toContain('"rows_changes"."rows_updated_at"');
    expect(aggregationQuery).toContain('"cells_changes"."cells_updated_at"');
    expect(aggregationQuery).toContain('"row_pages_changes"."row_pages_updated_at"');
    expect(aggregationQuery).not.toContain('"updatedAt"');
    expect(aggregationQuery).not.toContain('"propertiesUpdatedAt"');
    expect(aggregationQuery).not.toContain('"rowsUpdatedAt"');
    expect(aggregationQuery).not.toContain('"cellsUpdatedAt"');
    expect(aggregationQuery).not.toContain('"rowPagesUpdatedAt"');
  });
});
