import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { jsonbPreferenceValue, jsonbTextArray } from './workspace.repo';

function createCompiler() {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

describe('workspace settings SQL values', () => {
  const db = createCompiler();

  afterAll(async () => {
    await db.destroy();
  });

  it('keeps booleans as JSON booleans', () => {
    expect(jsonbPreferenceValue(true).compile(db)).toMatchObject({
      sql: '$1::boolean',
      parameters: [true],
    });
  });

  it('keeps text settings as JSON strings', () => {
    expect(jsonbPreferenceValue('admin').compile(db)).toMatchObject({
      sql: '$1::text',
      parameters: ['admin'],
    });
  });

  it('keeps tag settings as a JSON-compatible text array', () => {
    expect(jsonbTextArray(['todo', 'done']).compile(db)).toMatchObject({
      sql: 'ARRAY[$1, $2]::text[]',
      parameters: ['todo', 'done'],
    });
    expect(jsonbTextArray([]).compile(db)).toMatchObject({
      sql: 'ARRAY[]::text[]',
      parameters: [],
    });
  });
});
