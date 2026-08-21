import * as dotenv from 'dotenv';
import { CamelCasePlugin, Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { envPath, normalizePostgresUrl } from '../common/helpers';
import { postgres } from '../database/postgres-client';
import { resolveEnvironmentFileSecrets } from '../integrations/environment/environment-file-secrets';

export type CliArgs = Record<string, string | boolean>;

/**
 * Console entry points intentionally avoid booting the Nest application so a
 * recovery command never starts queue workers or competes with the server.
 */
export function loadCliEnv(): void {
  dotenv.config({ path: envPath });
  const fileSecretErrors = resolveEnvironmentFileSecrets(process.env);
  if (fileSecretErrors.length > 0) {
    throw new Error(
      `Invalid environment file secrets: ${fileSecretErrors.join('; ')}`,
    );
  }
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      continue;
    }

    const [key, ...rest] = raw.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  }

  return args;
}

export function requireStringArg(args: CliArgs, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`--${name}=<value> is required`);
  }
  return value.trim();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function createCliDatabase(): {
  db: Kysely<any>;
  close: () => Promise<void>;
} {
  const client = postgres(normalizePostgresUrl(requireEnv('DATABASE_URL')));
  const db = new Kysely<any>({
    dialect: new PostgresJSDialect({ postgres: client }),
    plugins: [new CamelCasePlugin()],
  });

  return {
    db,
    close: async () => {
      await db.destroy();
    },
  };
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
