jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { PageService } from './page.service';

jest.mock('@docmost/db/pagination/cursor-pagination', () => ({
  executeWithCursorPagination: jest.fn(async () => ({ items: [] })),
}));

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

describe('PageService getSidebarPages database node mapping', () => {
  const db = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
  });

  const service = new PageService(
    {} as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('builds root database nodes with page slug id for sidebar routing compatibility', async () => {
    await service.getSidebarPages('space-1', { limit: 20, query: '', adminView: false }, undefined, ['database']);

    expect(executeWithCursorPagination).toHaveBeenCalledTimes(1);

    const [query] = (executeWithCursorPagination as jest.Mock).mock.calls[0];
    const compiled = query.compile();

    expect(compiled.sql).toContain('"databasePage"."id" as "id"');
    expect(compiled.sql).toContain('"databasePage"."slugId" as "slugId"');
    expect(compiled.sql).toContain('"databases"."id" as "databaseId"');
    expect(compiled.sql).not.toContain("null as \"slugId\"");
  });
});
