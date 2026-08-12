import * as path from 'path';
import { promises as fs } from 'fs';
import { FileMigrationProvider, Kysely, sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';

export const POSTGRES_PREFLIGHT_EXIT = {
  ok: 0,
  migrationRequired: 20,
  unsupported: 30,
  migrationHistoryInvalid: 40,
} as const;

export type PostgresPreflightExitCode =
  (typeof POSTGRES_PREFLIGHT_EXIT)[keyof typeof POSTGRES_PREFLIGHT_EXIT];

export type PostgresRuntimeFamily = 'linux-gnu' | 'linux-musl' | 'unknown';

export interface PostgresPreflightIssue {
  code: string;
  exitCode: Exclude<PostgresPreflightExitCode, 0>;
  message: string;
}

export interface PostgresPreflightSnapshot {
  serverVersionNumber: number;
  serverVersion: string;
  runtimeFamily: PostgresRuntimeFamily;
  databaseSizeBytes: string;
  inRecovery: boolean;
  readOnly: boolean;
  defaultCollation: {
    provider: string;
    collate: string;
    ctype: string;
    recordedVersion: string | null;
    actualVersion: string | null;
    versionMismatch: boolean;
  };
  collationMismatches: Array<{
    collation: string;
    dependentObject: string;
    recordedVersion: string | null;
    actualVersion: string | null;
  }>;
  invalidIndexes: string[];
  knownMigrations: string[];
  appliedMigrations: string[];
  unexpectedDatabases: string[];
  unexpectedLoginRoles: string[];
  unexpectedTablespaces: string[];
  subscriptionCount: number;
  replicationSlotCount: number;
}

export interface PostgresPreflightOptions {
  expectedMajor?: number;
  expectedRuntimeFamily?: PostgresRuntimeFamily;
  requireLatest?: boolean;
}

export interface PostgresPreflightReport {
  status:
    | 'ok'
    | 'migration_required'
    | 'unsupported'
    | 'migration_history_invalid';
  exitCode: PostgresPreflightExitCode;
  checkedAt: string;
  database: {
    serverMajor: number;
    runtimeFamily: PostgresRuntimeFamily;
    sizeBytes: string;
    inRecovery: boolean;
    readOnly: boolean;
    defaultCollation: PostgresPreflightSnapshot['defaultCollation'];
    collationMismatchCount: number;
    collationMismatches: PostgresPreflightSnapshot['collationMismatches'];
    invalidIndexCount: number;
    invalidIndexes: string[];
  };
  migrations: {
    known: number;
    applied: number;
    pending: number;
    historyValid: boolean;
    unknownApplied: string[];
    expectedNext: string | null;
  };
  topology: {
    unexpectedDatabaseCount: number;
    unexpectedLoginRoleCount: number;
    unexpectedTablespaceCount: number;
    subscriptionCount: number;
    replicationSlotCount: number;
    unexpectedDatabases: string[];
    unexpectedLoginRoles: string[];
    unexpectedTablespaces: string[];
  };
  issues: PostgresPreflightIssue[];
}

interface RuntimeRow {
  serverVersionNumber: number | string;
  serverVersion: string;
  databaseSizeBytes: string;
  inRecovery: boolean;
  readOnly: boolean;
}

interface DefaultCollationRow {
  provider: string;
  collate: string;
  ctype: string;
  recordedVersion: string | null;
  actualVersion: string | null;
  versionMismatch: boolean;
}

interface NamedCollationRow {
  collation: string;
  dependentObject: string;
  recordedVersion: string | null;
  actualVersion: string | null;
}

interface NameRow {
  name: string;
}

interface CountRow {
  count: number | string;
}

const migrationFolder = path.join(__dirname, 'migrations');

export function detectPostgresRuntimeFamily(
  version: string,
): PostgresRuntimeFamily {
  const normalized = version.toLowerCase();
  if (normalized.includes('linux-musl')) {
    return 'linux-musl';
  }
  if (normalized.includes('linux-gnu')) {
    return 'linux-gnu';
  }
  return 'unknown';
}

async function collectKnownMigrations(): Promise<string[]> {
  const provider = new FileMigrationProvider({ fs, path, migrationFolder });
  return Object.keys(await provider.getMigrations()).sort();
}

async function collectAppliedMigrations(db: Kysely<any>): Promise<string[]> {
  const table = await sql<{ tableName: string | null }>`
    SELECT to_regclass('public.kysely_migration')::text AS "tableName"
  `.execute(db);
  if (!table.rows[0]?.tableName) {
    return [];
  }

  const applied = await sql<{ name: string }>`
    SELECT name
    FROM public.kysely_migration
    ORDER BY timestamp ASC, name ASC
  `.execute(db);
  return applied.rows.map((row) => row.name);
}

function parseCount(row: CountRow | undefined): number {
  return Number(row?.count ?? 0);
}

export async function collectPostgresPreflightSnapshot(
  database: KyselyDB,
): Promise<PostgresPreflightSnapshot> {
  const db = database.withoutPlugins() as Kysely<any>;
  const runtime = await sql<RuntimeRow>`
    SELECT
      current_setting('server_version_num')::integer AS "serverVersionNumber",
      version() AS "serverVersion",
      pg_database_size(current_database())::text AS "databaseSizeBytes",
      pg_is_in_recovery() AS "inRecovery",
      current_setting('transaction_read_only') = 'on' AS "readOnly"
  `.execute(db);
  const defaultCollation = await sql<DefaultCollationRow>`
    SELECT
      datlocprovider::text AS provider,
      datcollate AS collate,
      datctype AS ctype,
      datcollversion AS "recordedVersion",
      pg_database_collation_actual_version(oid) AS "actualVersion",
      datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid)
        AS "versionMismatch"
    FROM pg_database
    WHERE datname = current_database()
  `.execute(db);
  const collationMismatches = await sql<NamedCollationRow>`
    SELECT DISTINCT
      quote_ident(namespace.nspname) || '.' || quote_ident(collation_state.collname)
        AS "collation",
      pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid)
        AS "dependentObject",
      collation_state.collversion AS "recordedVersion",
      pg_collation_actual_version(collation_state.oid) AS "actualVersion"
    FROM pg_depend AS dependency
    JOIN pg_collation AS collation_state
      ON dependency.refclassid = 'pg_collation'::regclass
      AND dependency.refobjid = collation_state.oid
    JOIN pg_namespace AS namespace ON namespace.oid = collation_state.collnamespace
    WHERE collation_state.collversion IS DISTINCT FROM
      pg_collation_actual_version(collation_state.oid)
    ORDER BY "collation", "dependentObject"
  `.execute(db);
  const invalidIndexes = await sql<NameRow>`
    SELECT quote_ident(namespace.nspname) || '.' || quote_ident(index_class.relname)
      AS name
    FROM pg_index AS index_state
    JOIN pg_class AS index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
    WHERE NOT index_state.indisvalid
    ORDER BY name
  `.execute(db);
  const unexpectedDatabases = await sql<NameRow>`
    SELECT datname AS name
    FROM pg_database
    WHERE datallowconn
      AND NOT datistemplate
      AND datname NOT IN (current_database(), 'postgres')
    ORDER BY datname
  `.execute(db);
  const unexpectedLoginRoles = await sql<NameRow>`
    SELECT rolname AS name
    FROM pg_roles
    WHERE rolcanlogin
      AND rolname <> current_user
    ORDER BY rolname
  `.execute(db);
  const unexpectedTablespaces = await sql<NameRow>`
    SELECT spcname AS name
    FROM pg_tablespace
    WHERE spcname NOT IN ('pg_default', 'pg_global')
    ORDER BY spcname
  `.execute(db);
  const subscriptions = await sql<CountRow>`
    SELECT count(*)::integer AS count FROM pg_subscription
  `.execute(db);
  const replicationSlots = await sql<CountRow>`
    SELECT count(*)::integer AS count FROM pg_replication_slots
  `.execute(db);
  const runtimeRow = runtime.rows[0];
  const defaultCollationRow = defaultCollation.rows[0];

  if (!runtimeRow || !defaultCollationRow) {
    throw new Error('PostgreSQL preflight could not read database metadata');
  }

  const [knownMigrations, appliedMigrations] = await Promise.all([
    collectKnownMigrations(),
    collectAppliedMigrations(db),
  ]);

  return {
    serverVersionNumber: Number(runtimeRow.serverVersionNumber),
    serverVersion: runtimeRow.serverVersion,
    runtimeFamily: detectPostgresRuntimeFamily(runtimeRow.serverVersion),
    databaseSizeBytes: runtimeRow.databaseSizeBytes,
    inRecovery: runtimeRow.inRecovery,
    readOnly: runtimeRow.readOnly,
    defaultCollation: defaultCollationRow,
    collationMismatches: collationMismatches.rows,
    invalidIndexes: invalidIndexes.rows.map((row) => row.name),
    knownMigrations,
    appliedMigrations,
    unexpectedDatabases: unexpectedDatabases.rows.map((row) => row.name),
    unexpectedLoginRoles: unexpectedLoginRoles.rows.map((row) => row.name),
    unexpectedTablespaces: unexpectedTablespaces.rows.map((row) => row.name),
    subscriptionCount: parseCount(subscriptions.rows[0]),
    replicationSlotCount: parseCount(replicationSlots.rows[0]),
  };
}

function migrationHistoryIsPrefix(
  snapshot: PostgresPreflightSnapshot,
): boolean {
  if (
    new Set(snapshot.appliedMigrations).size !==
    snapshot.appliedMigrations.length
  ) {
    return false;
  }
  if (snapshot.appliedMigrations.length > snapshot.knownMigrations.length) {
    return false;
  }
  return snapshot.appliedMigrations.every(
    (migration, index) => snapshot.knownMigrations[index] === migration,
  );
}

function statusForExitCode(
  exitCode: PostgresPreflightExitCode,
): PostgresPreflightReport['status'] {
  if (exitCode === POSTGRES_PREFLIGHT_EXIT.migrationHistoryInvalid) {
    return 'migration_history_invalid';
  }
  if (exitCode === POSTGRES_PREFLIGHT_EXIT.unsupported) {
    return 'unsupported';
  }
  if (exitCode === POSTGRES_PREFLIGHT_EXIT.migrationRequired) {
    return 'migration_required';
  }
  return 'ok';
}

export function evaluatePostgresPreflight(
  snapshot: PostgresPreflightSnapshot,
  options: PostgresPreflightOptions = {},
): PostgresPreflightReport {
  const expectedMajor = options.expectedMajor ?? 18;
  const expectedRuntimeFamily = options.expectedRuntimeFamily ?? 'linux-gnu';
  const serverMajor = Math.floor(snapshot.serverVersionNumber / 10000);
  const issues: PostgresPreflightIssue[] = [];
  const addIssue = (
    code: string,
    exitCode: Exclude<PostgresPreflightExitCode, 0>,
    message: string,
  ) => issues.push({ code, exitCode, message });

  if (serverMajor !== expectedMajor) {
    addIssue(
      'postgres_major_mismatch',
      POSTGRES_PREFLIGHT_EXIT.migrationRequired,
      `PostgreSQL major ${serverMajor} does not match required major ${expectedMajor}`,
    );
  }
  if (snapshot.runtimeFamily === 'unknown') {
    addIssue(
      'postgres_runtime_unknown',
      POSTGRES_PREFLIGHT_EXIT.unsupported,
      'PostgreSQL runtime family could not be classified',
    );
  } else if (snapshot.runtimeFamily !== expectedRuntimeFamily) {
    addIssue(
      'postgres_runtime_mismatch',
      POSTGRES_PREFLIGHT_EXIT.migrationRequired,
      `PostgreSQL runtime ${snapshot.runtimeFamily} does not match required runtime ${expectedRuntimeFamily}`,
    );
  }
  if (snapshot.defaultCollation.versionMismatch) {
    addIssue(
      'database_collation_version_mismatch',
      POSTGRES_PREFLIGHT_EXIT.migrationRequired,
      'The database default collation version does not match the active runtime',
    );
  }
  if (snapshot.collationMismatches.length > 0) {
    addIssue(
      'dependent_collation_version_mismatch',
      POSTGRES_PREFLIGHT_EXIT.migrationRequired,
      `${snapshot.collationMismatches.length} used collation dependencies have version mismatches`,
    );
  }
  if (snapshot.invalidIndexes.length > 0) {
    addIssue(
      'invalid_indexes',
      POSTGRES_PREFLIGHT_EXIT.unsupported,
      `${snapshot.invalidIndexes.length} invalid indexes require operator review`,
    );
  }
  if (snapshot.inRecovery || snapshot.readOnly) {
    addIssue(
      'database_not_writable',
      POSTGRES_PREFLIGHT_EXIT.unsupported,
      'The database must be a writable primary for the supported Compose topology',
    );
  }
  if (
    snapshot.unexpectedDatabases.length > 0 ||
    snapshot.unexpectedLoginRoles.length > 0 ||
    snapshot.unexpectedTablespaces.length > 0 ||
    snapshot.subscriptionCount > 0 ||
    snapshot.replicationSlotCount > 0
  ) {
    addIssue(
      'unsupported_database_topology',
      POSTGRES_PREFLIGHT_EXIT.unsupported,
      'Additional databases, login roles, tablespaces, or replication state require a DBA-managed migration',
    );
  }

  const historyValid = migrationHistoryIsPrefix(snapshot);
  const knownMigrationSet = new Set(snapshot.knownMigrations);
  const unknownApplied = snapshot.appliedMigrations.filter(
    (migration) => !knownMigrationSet.has(migration),
  );
  const pending = historyValid
    ? snapshot.knownMigrations.length - snapshot.appliedMigrations.length
    : snapshot.knownMigrations.length;
  if (!historyValid || snapshot.knownMigrations.length === 0) {
    addIssue(
      'migration_history_invalid',
      POSTGRES_PREFLIGHT_EXIT.migrationHistoryInvalid,
      'Applied migrations are not an exact prefix of the packaged migration set',
    );
  } else if (options.requireLatest && pending > 0) {
    addIssue(
      'pending_migrations',
      POSTGRES_PREFLIGHT_EXIT.migrationHistoryInvalid,
      `${pending} packaged migrations have not been applied`,
    );
  }

  const exitCode = issues.reduce<PostgresPreflightExitCode>(
    (highest, issue) =>
      Math.max(highest, issue.exitCode) as PostgresPreflightExitCode,
    POSTGRES_PREFLIGHT_EXIT.ok,
  );

  return {
    status: statusForExitCode(exitCode),
    exitCode,
    checkedAt: new Date().toISOString(),
    database: {
      serverMajor,
      runtimeFamily: snapshot.runtimeFamily,
      sizeBytes: snapshot.databaseSizeBytes,
      inRecovery: snapshot.inRecovery,
      readOnly: snapshot.readOnly,
      defaultCollation: snapshot.defaultCollation,
      collationMismatchCount: snapshot.collationMismatches.length,
      collationMismatches: snapshot.collationMismatches,
      invalidIndexCount: snapshot.invalidIndexes.length,
      invalidIndexes: snapshot.invalidIndexes,
    },
    migrations: {
      known: snapshot.knownMigrations.length,
      applied: snapshot.appliedMigrations.length,
      pending: Math.max(0, pending),
      historyValid,
      unknownApplied,
      expectedNext: historyValid
        ? (snapshot.knownMigrations[snapshot.appliedMigrations.length] ?? null)
        : null,
    },
    topology: {
      unexpectedDatabaseCount: snapshot.unexpectedDatabases.length,
      unexpectedLoginRoleCount: snapshot.unexpectedLoginRoles.length,
      unexpectedTablespaceCount: snapshot.unexpectedTablespaces.length,
      subscriptionCount: snapshot.subscriptionCount,
      replicationSlotCount: snapshot.replicationSlotCount,
      unexpectedDatabases: snapshot.unexpectedDatabases,
      unexpectedLoginRoles: snapshot.unexpectedLoginRoles,
      unexpectedTablespaces: snapshot.unexpectedTablespaces,
    },
    issues,
  };
}

export async function runPostgresPreflight(
  db: KyselyDB,
  options: PostgresPreflightOptions = {},
): Promise<PostgresPreflightReport> {
  return evaluatePostgresPreflight(
    await collectPostgresPreflightSnapshot(db),
    options,
  );
}
