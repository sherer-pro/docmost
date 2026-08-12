import {
  detectPostgresRuntimeFamily,
  evaluatePostgresPreflight,
  POSTGRES_PREFLIGHT_EXIT,
  PostgresPreflightSnapshot,
} from '../postgres-preflight';

function snapshot(
  overrides: Partial<PostgresPreflightSnapshot> = {},
): PostgresPreflightSnapshot {
  return {
    serverVersionNumber: 180004,
    serverVersion:
      'PostgreSQL 18.4 on x86_64-pc-linux-gnu, compiled by gcc, 64-bit',
    runtimeFamily: 'linux-gnu',
    databaseSizeBytes: '1048576',
    inRecovery: false,
    readOnly: false,
    defaultCollation: {
      provider: 'c',
      collate: 'en_US.utf8',
      ctype: 'en_US.utf8',
      recordedVersion: '2.41',
      actualVersion: '2.41',
      versionMismatch: false,
    },
    collationMismatches: [],
    invalidIndexes: [],
    knownMigrations: ['001-first', '002-second'],
    appliedMigrations: ['001-first', '002-second'],
    unexpectedDatabases: [],
    unexpectedLoginRoles: [],
    unexpectedTablespaces: [],
    subscriptionCount: 0,
    replicationSlotCount: 0,
    ...overrides,
  };
}

describe('PostgreSQL production preflight', () => {
  it('classifies GNU and musl builds without guessing unknown runtimes', () => {
    expect(detectPostgresRuntimeFamily('x86_64-pc-linux-gnu')).toBe(
      'linux-gnu',
    );
    expect(detectPostgresRuntimeFamily('x86_64-pc-linux-musl')).toBe(
      'linux-musl',
    );
    expect(detectPostgresRuntimeFamily('PostgreSQL custom build')).toBe(
      'unknown',
    );
  });

  it('passes a current Debian cluster and migration prefix', () => {
    const report = evaluatePostgresPreflight(snapshot(), {
      requireLatest: true,
    });

    expect(report.exitCode).toBe(POSTGRES_PREFLIGHT_EXIT.ok);
    expect(report.status).toBe('ok');
    expect(report.issues).toEqual([]);
  });

  it('requires a logical migration for an Alpine runtime', () => {
    const report = evaluatePostgresPreflight(
      snapshot({
        serverVersion:
          'PostgreSQL 18.4 on x86_64-pc-linux-musl, compiled by gcc, 64-bit',
        runtimeFamily: 'linux-musl',
      }),
    );

    expect(report.exitCode).toBe(POSTGRES_PREFLIGHT_EXIT.migrationRequired);
    expect(report.issues.map((issue) => issue.code)).toContain(
      'postgres_runtime_mismatch',
    );
  });

  it('does not hide default or dependent collation mismatches', () => {
    const report = evaluatePostgresPreflight(
      snapshot({
        defaultCollation: {
          ...snapshot().defaultCollation,
          actualVersion: null,
          versionMismatch: true,
        },
        collationMismatches: [
          {
            collation: 'pg_catalog.en_US',
            dependentObject: 'index public.pages_title_idx',
            recordedVersion: '153.128',
            actualVersion: '153.136',
          },
        ],
      }),
    );

    expect(report.exitCode).toBe(POSTGRES_PREFLIGHT_EXIT.migrationRequired);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'database_collation_version_mismatch',
        'dependent_collation_version_mismatch',
      ]),
    );
  });

  it('routes invalid indexes and extended topology to DBA review', () => {
    const report = evaluatePostgresPreflight(
      snapshot({
        invalidIndexes: ['public.invalid_idx'],
        unexpectedLoginRoles: ['reporting_user'],
      }),
    );

    expect(report.exitCode).toBe(POSTGRES_PREFLIGHT_EXIT.unsupported);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid_indexes',
        'unsupported_database_topology',
      ]),
    );
  });

  it('allows pending migrations before the one-shot job only', () => {
    const pendingSnapshot = snapshot({
      appliedMigrations: ['001-first'],
    });

    expect(
      evaluatePostgresPreflight(pendingSnapshot, { requireLatest: false })
        .exitCode,
    ).toBe(POSTGRES_PREFLIGHT_EXIT.ok);
    expect(
      evaluatePostgresPreflight(pendingSnapshot, { requireLatest: true })
        .exitCode,
    ).toBe(POSTGRES_PREFLIGHT_EXIT.migrationHistoryInvalid);
  });

  it('rejects unknown, duplicated, and out-of-order migration history', () => {
    for (const appliedMigrations of [
      ['001-first', 'unknown'],
      ['001-first', '001-first'],
      ['002-second'],
    ]) {
      const report = evaluatePostgresPreflight(snapshot({ appliedMigrations }));
      expect(report.exitCode).toBe(
        POSTGRES_PREFLIGHT_EXIT.migrationHistoryInvalid,
      );
      expect(report.issues.map((issue) => issue.code)).toContain(
        'migration_history_invalid',
      );
    }
  });
});
