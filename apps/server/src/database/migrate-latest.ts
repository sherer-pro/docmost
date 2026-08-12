import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as dotenv from 'dotenv';
import { envPath, normalizePostgresUrl } from '../common/helpers';
import { resolveEnvironmentFileSecrets } from '../integrations/environment/environment-file-secrets';
import { postgres } from './postgres-client';
import { runPostgresPreflight } from './postgres-preflight';
import { MigrationService } from './services/migration.service';

async function main(): Promise<void> {
  dotenv.config({ path: envPath });
  const fileSecretErrors = resolveEnvironmentFileSecrets(process.env);
  if (fileSecretErrors.length > 0 || !process.env.DATABASE_URL) {
    throw new Error('Invalid database connection configuration');
  }

  const db = new Kysely<any>({
    dialect: new PostgresJSDialect({
      postgres: postgres(normalizePostgresUrl(process.env.DATABASE_URL), {
        max: 1,
      }),
    }),
  });

  try {
    const preflight = await runPostgresPreflight(db as never, {
      requireLatest: false,
    });
    if (preflight.exitCode !== 0) {
      console.log(JSON.stringify(preflight));
      process.exitCode = preflight.exitCode;
      return;
    }
    await new MigrationService(db as never).migrateToLatest();
    const postflight = await runPostgresPreflight(db as never, {
      requireLatest: true,
    });
    if (postflight.exitCode !== 0) {
      console.log(JSON.stringify(postflight));
      process.exitCode = postflight.exitCode;
    }
  } finally {
    await db.destroy();
  }
}

void main().catch(() => {
  console.error('Database migration job failed');
  process.exitCode = 1;
});
