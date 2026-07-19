import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { DatabaseRowRepo } from './database-row.repo';

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

describe('DatabaseRowRepo custom fields SQL', () => {
  const db = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
  });
  const repo = new DatabaseRowRepo(db as any);

  afterAll(async () => {
    await db.destroy();
  });

  it('normalizes AI role in database row payloads', () => {
    const query = (repo as any).buildRowsQuery(
      'database-1',
      'workspace-1',
      'space-1',
    );
    const compiled = query.compile();

    expect(compiled.sql).toContain("'aiRole'");
    expect(compiled.sql).toContain("'COAUTHOR'");
    expect(compiled.sql).toContain('ELSE \'"NONE"\'::jsonb');
  });
});
