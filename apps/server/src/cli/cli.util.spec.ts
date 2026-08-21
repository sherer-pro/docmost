import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENVIRONMENT_FILE_SECRET_KEYS } from '../integrations/environment/environment-file-secrets';
import { createCliDatabase, loadCliEnv } from './cli.util';

jest.mock('dotenv', () => ({ config: jest.fn() }));

const trackedEnvironmentKeys = ENVIRONMENT_FILE_SECRET_KEYS.flatMap((key) => [
  key,
  `${key}_FILE`,
]);
const originalEnvironment = new Map(
  trackedEnvironmentKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of trackedEnvironmentKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of trackedEnvironmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('loadCliEnv', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'docmost-cli-env-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads database and Redis URLs from file-backed secrets', () => {
    const databaseUrl = 'postgresql://docmost:secret@db:5432/docmost';
    const redisUrl = 'redis://redis:6379';
    const databaseUrlFile = join(directory, 'database-url');
    const redisUrlFile = join(directory, 'redis-url');
    writeFileSync(databaseUrlFile, `${databaseUrl}\n`, 'utf8');
    writeFileSync(redisUrlFile, `${redisUrl}\n`, 'utf8');
    process.env.DATABASE_URL_FILE = databaseUrlFile;
    process.env.REDIS_URL_FILE = redisUrlFile;

    loadCliEnv();

    expect(process.env.DATABASE_URL).toBe(databaseUrl);
    expect(process.env.REDIS_URL).toBe(redisUrl);
  });

  it('rejects ambiguous direct and file-backed secret configuration', () => {
    const redisUrlFile = join(directory, 'redis-url');
    writeFileSync(redisUrlFile, 'redis://redis:6379', 'utf8');
    process.env.REDIS_URL = 'redis://redis:6379';
    process.env.REDIS_URL_FILE = redisUrlFile;

    expect(() => loadCliEnv()).toThrow(
      'Invalid environment file secrets: REDIS_URL and REDIS_URL_FILE cannot be configured together',
    );
  });
});

describe('createCliDatabase', () => {
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
