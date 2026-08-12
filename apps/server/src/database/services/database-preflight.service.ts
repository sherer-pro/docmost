import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { DatabasePreflightError } from '../../common/errors/startup.errors';
import {
  PostgresPreflightOptions,
  PostgresPreflightReport,
  runPostgresPreflight,
} from '../postgres-preflight';

@Injectable()
export class DatabasePreflightService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async check(
    options: PostgresPreflightOptions = {},
  ): Promise<PostgresPreflightReport> {
    return runPostgresPreflight(this.db, options);
  }

  async assertSafe(options: PostgresPreflightOptions = {}): Promise<void> {
    const report = await this.check(options);
    if (report.exitCode !== 0) {
      throw new DatabasePreflightError(
        report.exitCode,
        report.issues.map((issue) => issue.code),
      );
    }
  }
}
