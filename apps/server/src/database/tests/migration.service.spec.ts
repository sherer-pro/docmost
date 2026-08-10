import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { MigrationService } from '../services/migration.service';

/**
 * Migrations address physical snake_case column names. If the migrator ever
 * receives the application's Kysely instance as-is, CamelCasePlugin remaps
 * result keys and a data migration reading `row.some_column` silently sees
 * `undefined` — it reports success while doing nothing.
 */
describe('MigrationService', () => {
  const createDb = () =>
    new Kysely<any>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
      plugins: [new CamelCasePlugin()],
    });

  it('runs migrations on a connection without query plugins', async () => {
    const db = createDb();
    const service = new MigrationService(db as never);

    const migrationDb = service.getMigrationDb(db as never);

    expect(db.getExecutor().plugins).toHaveLength(1);
    expect(migrationDb.getExecutor().plugins).toHaveLength(0);

    await db.destroy();
  });

  it('keeps snake_case result keys for migrations', async () => {
    const db = createDb();
    const service = new MigrationService(db as never);
    const row = { id: 'x', oidc_client_secret: 'plaintext' };

    const applyPlugins = async (plugins: readonly any[]) => {
      let result: any = { rows: [{ ...row }] };
      for (const plugin of plugins) {
        result = await plugin.transformResult({ result, queryId: {} });
      }
      return result.rows[0] as Record<string, unknown>;
    };

    const applicationRow = await applyPlugins(db.getExecutor().plugins);
    const migrationRow = await applyPlugins(
      service.getMigrationDb(db as never).getExecutor().plugins,
    );

    expect(Object.keys(applicationRow)).toContain('oidcClientSecret');
    expect(Object.keys(migrationRow)).toContain('oidc_client_secret');

    await db.destroy();
  });
});
