import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { promises as fs } from 'fs';
import { Migrator, FileMigrationProvider, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { DatabaseMigrationError } from '../../common/errors/startup.errors';

const MIGRATION_LOCK_NAMESPACE = 27517;
const MIGRATION_LOCK_ID = 20260619;

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(`Database${MigrationService.name}`);

  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async migrateToLatest(): Promise<void> {
    const hasMigrationError = await this.db.connection().execute(async (db) => {
      await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})`.execute(
        db,
      );
      this.logger.log('Acquired database migration advisory lock');

      try {
        return await this.runMigrations(db as KyselyDB);
      } finally {
        await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})`.execute(
          db,
        );
        this.logger.log('Released database migration advisory lock');
      }
    });

    if (hasMigrationError) {
      throw new DatabaseMigrationError();
    }
  }

  /**
   * Returns the connection migrations must run on.
   *
   * Migrations address columns by their physical snake_case names, exactly like
   * the standalone `migration:latest` CLI does. Running them through the
   * application instance would add CamelCasePlugin and hand every row back with
   * camelCase keys, so a migration reading `row.some_column` would silently see
   * `undefined` and "succeed" without doing its work.
   */
  getMigrationDb(db: KyselyDB): KyselyDB {
    return db.withoutPlugins() as KyselyDB;
  }

  private async runMigrations(db: KyselyDB): Promise<boolean> {
    const migrator = new Migrator({
      db: this.getMigrationDb(db),
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.join(__dirname, '..', 'migrations'),
      }),
    });

    const { error, results } = await migrator.migrateToLatest();

    if (results && results.length === 0) {
      this.logger.log('No pending database migrations');
      return;
    }

    results?.forEach((it) => {
      if (it.status === 'Success') {
        this.logger.log(
          `Migration "${it.migrationName}" executed successfully`,
        );
      } else if (it.status === 'Error') {
        this.logger.error(`Failed to execute migration "${it.migrationName}"`);
      }
    });

    if (error) {
      this.logger.error('Failed to run database migration');
      this.logger.error(error);
      return true;
    }

    return false;
  }
}
