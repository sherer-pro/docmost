import { Kysely, PostgresDialect, sql } from 'kysely';
import { databasePropertyValue } from './database-computed-value';

const id = '00000000-0000-4000-8000-000000000001';
const budget = '00000000-0000-4000-8000-000000000002';
describe('database formula SQL compiler', () => {
  const db = new Kysely<any>({
    dialect: new PostgresDialect({ pool: {} as any }),
  });
  it('keeps literal source text in bound parameters and uses a closed SQL grammar', () => {
    const literal = "'); select pg_sleep(9); --";
    const value = databasePropertyValue(id, [
      {
        id,
        type: 'formula',
        settings: {
          languageVersion: 1,
          resultType: 'text',
          expression: `concat(${JSON.stringify(literal)}, "text")`,
        },
      },
    ]);
    const compiled = db.selectFrom('pages').select(value.as('value')).compile();
    expect(compiled.sql).not.toContain(literal);
    expect(compiled.parameters).toContain(JSON.stringify(literal));
    expect(compiled.sql).toContain('octet_length');
    expect(compiled.sql.length).toBeLessThan(10000);
  });
  it('guards division and shares referenced cells instead of expanding duplicate dependencies', () => {
    const value = databasePropertyValue(id, [
      { id: budget, type: 'number' },
      {
        id,
        type: 'formula',
        settings: {
          languageVersion: 1,
          resultType: 'number',
          expression: `divide(prop("${budget}"), prop("${budget}"))`,
        },
      },
    ]);
    const compiled = db
      .selectFrom('databaseRows')
      .innerJoin('pages', 'pages.id', 'databaseRows.pageId')
      .select(value.as('value'))
      .compile();
    expect(compiled.sql).toContain('nullif');
    expect(compiled.parameters).toContain('division_by_zero');
    expect(compiled.sql.match(/from database_cells/g)).toHaveLength(1);
    expect(compiled.sql).not.toContain(budget);
  });
  it('uses row and page mutation metadata for computed system fields', () => {
    const compiled =
      sql`${databasePropertyValue(id, [{ id, type: 'updated_at' }])}`.compile(
        db,
      );
    expect(compiled.sql).toContain('greatest');
    expect(compiled.sql).toContain('"pages"."updatedAt"');
    expect(compiled.sql).toContain('"databaseRows"."updatedAt"');
  });
});
