import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { postgresJsonb } from './postgres-jsonb.util';

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

describe('postgresJsonb', () => {
  const db = new Kysely<any>({
    dialect: new TestPostgresDialect() as any,
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('keeps structured JSON as a structured query parameter', () => {
    const value = ['search.query', 'page.tree.read'];
    const compiled = db
      .insertInto('profiles')
      .values({ allowedBuiltinCapabilities: postgresJsonb(value) })
      .compile();

    expect(compiled.sql).toContain('$1::jsonb');
    expect(compiled.parameters).toEqual([value]);
    expect(compiled.parameters).not.toEqual([JSON.stringify(value)]);
  });
});
