import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as dotenv from 'dotenv';
import { envPath, normalizePostgresUrl } from '../common/helpers';
import { resolveEnvironmentFileSecrets } from '../integrations/environment/environment-file-secrets';
import { postgres } from './postgres-client';
import {
  POSTGRES_PREFLIGHT_EXIT,
  PostgresRuntimeFamily,
  runPostgresPreflight,
} from './postgres-preflight';

function parseExpectedMajor(value: string | undefined): number {
  const parsed = Number(value ?? 18);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 18;
}

async function main(): Promise<void> {
  dotenv.config({ path: envPath });
  const fileSecretErrors = resolveEnvironmentFileSecrets(process.env);
  if (fileSecretErrors.length > 0 || !process.env.DATABASE_URL) {
    console.log(
      JSON.stringify({
        status: 'unsupported',
        exitCode: POSTGRES_PREFLIGHT_EXIT.unsupported,
        issues: [
          {
            code: 'database_connection_configuration_invalid',
            exitCode: POSTGRES_PREFLIGHT_EXIT.unsupported,
            message: 'Database connection configuration is unavailable',
          },
        ],
      }),
    );
    process.exitCode = POSTGRES_PREFLIGHT_EXIT.unsupported;
    return;
  }

  const db = new Kysely<any>({
    dialect: new PostgresJSDialect({
      postgres: postgres(normalizePostgresUrl(process.env.DATABASE_URL), {
        max: 1,
      }),
    }),
  });

  try {
    const report = await runPostgresPreflight(db as never, {
      expectedMajor: parseExpectedMajor(process.env.POSTGRES_EXPECTED_MAJOR),
      expectedRuntimeFamily: (process.env.POSTGRES_EXPECTED_RUNTIME ??
        'linux-gnu') as PostgresRuntimeFamily,
      requireLatest:
        process.argv.includes('--require-latest') ||
        process.env.DATABASE_PREFLIGHT_REQUIRE_LATEST === 'true',
    });
    console.log(JSON.stringify(report));
    process.exitCode = report.exitCode;
  } catch {
    console.log(
      JSON.stringify({
        status: 'unsupported',
        exitCode: POSTGRES_PREFLIGHT_EXIT.unsupported,
        issues: [
          {
            code: 'database_preflight_failed',
            exitCode: POSTGRES_PREFLIGHT_EXIT.unsupported,
            message: 'Database preflight could not complete',
          },
        ],
      }),
    );
    process.exitCode = POSTGRES_PREFLIGHT_EXIT.unsupported;
  } finally {
    await db.destroy();
  }
}

void main();
