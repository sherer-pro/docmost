import * as path from 'path';
import { promises as fs } from 'fs';
import { Kysely, Migrator, FileMigrationProvider } from 'kysely';
import { run } from 'kysely-migration-cli';
import * as dotenv from 'dotenv';
import { envPath, normalizePostgresUrl } from '../common/helpers';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { postgres } from './postgres-client';
import { resolveEnvironmentFileSecrets } from '../integrations/environment/environment-file-secrets';

dotenv.config({ path: envPath });
const fileSecretErrors = resolveEnvironmentFileSecrets(process.env);
if (fileSecretErrors.length > 0) {
  throw new Error(`Invalid environment file secrets: ${fileSecretErrors.join('; ')}`);
}

const migrationFolder = path.join(__dirname, './migrations');

const db = new Kysely<any>({
  dialect: new PostgresJSDialect({
    postgres: postgres(normalizePostgresUrl(process.env.DATABASE_URL)),
  }),
});

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder,
  }),
});

run(db, migrator, migrationFolder);
