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

  it('compares select cells by the displayed option label', () => {
    const expression = (repo as any).buildRowCellComparableValueExpression({
      rowAlias: 'databaseRows',
      propertyId: 'property-1',
      property: {
        id: 'property-1',
        type: 'select',
        settings: {
          options: [{ value: 'in_progress', label: 'In progress' }],
        },
      },
      workspaceId: 'workspace-1',
    });
    const compiled = db
      .selectFrom('databaseRows')
      .select(expression.as('value'))
      .compile();

    expect(compiled.sql).toContain('case');
    expect(compiled.parameters).toEqual(
      expect.arrayContaining(['in_progress', 'in progress']),
    );
  });

  it('compares user cells by the current member name', () => {
    const expression = (repo as any).buildRowCellComparableValueExpression({
      rowAlias: 'databaseRows',
      propertyId: 'property-1',
      property: { id: 'property-1', type: 'user' },
      workspaceId: 'workspace-1',
    });
    const compiled = db
      .selectFrom('databaseRows')
      .select(expression.as('value'))
      .compile();

    expect(compiled.sql).toContain('"users" as "comparableUser"');
    expect(compiled.sql).toContain('"comparableUser"."name"');
  });

  it('compares page reference cells by the current page title', () => {
    const expression = (repo as any).buildRowCellComparableValueExpression({
      rowAlias: 'databaseRows',
      propertyId: 'property-1',
      property: { id: 'property-1', type: 'page_reference' },
      workspaceId: 'workspace-1',
    });
    const compiled = db
      .selectFrom('databaseRows')
      .select(expression.as('value'))
      .compile();

    expect(compiled.sql).toContain('"pages" as "comparablePage"');
    expect(compiled.sql).toContain('"comparablePage"."title"');
  });
});
