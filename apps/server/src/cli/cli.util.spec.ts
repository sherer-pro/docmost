import { createCliDatabase } from './cli.util';

describe('createCliDatabase', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('compiles camelCase model fields to snake_case database columns', async () => {
    process.env.DATABASE_URL = 'postgresql://audit:audit@127.0.0.1:1/audit';
    const { db, close } = createCliDatabase();

    try {
      const query = db
        .updateTable('workspaces')
        .set({ enforceSso: false, updatedAt: new Date(0) })
        .compile();

      expect(query.sql).toContain('"enforce_sso"');
      expect(query.sql).toContain('"updated_at"');
      expect(query.sql).not.toContain('"enforceSso"');
    } finally {
      await close();
    }
  });
});
