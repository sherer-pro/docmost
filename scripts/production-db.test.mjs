import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapacityPlan,
  buildMigrationFailureReport,
  candidateVolumeName,
  commandState,
  compareInventories,
  composeServiceLookupArgs,
  migrationRetryState,
  parseArguments,
  parseEnvFile,
  previousApplicationContainerLookupArgs,
  rollbackPreflightMatches,
  rollbackPhaseCanRun,
  rollbackState,
  serializeEnvFile,
  storageArchiveDockerArgs,
} from "./production-db.mjs";

test("keeps the legacy candidate volume name while it fits", () => {
  assert.equal(
    candidateVolumeName("docmost_db_data", "20260902031100000"),
    "docmost_db_data-candidate-20260902031100000",
  );
});

test("bounds chained candidate volume names deterministically", () => {
  const source =
    "docmost_db_data-candidate-20260816123444838-candidate-20260823112737921-candidate-20260824170929900-candidate-20260829183514966";
  const migrationId = "20260902031100000";
  const candidate = candidateVolumeName(source, migrationId);

  assert.equal(candidate.length, 128);
  assert.match(candidate, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u);
  assert.match(candidate, /-[0-9a-f]{16}-candidate-20260902031100000$/u);
  assert.equal(candidateVolumeName(source, migrationId), candidate);
  assert.notEqual(candidateVolumeName(`${source}x`, migrationId), candidate);

  const nextCandidate = candidateVolumeName(candidate, "20260903031100000");
  assert.equal(nextCandidate.length, 128);
  assert.match(nextCandidate, /-[0-9a-f]{16}-candidate-20260903031100000$/u);
});

test("includes stopped API container only when rollback provenance needs it", () => {
  assert.deepEqual(previousApplicationContainerLookupArgs(), [
    "ps",
    "-a",
    "-q",
    "docmost",
  ]);
  assert.deepEqual(composeServiceLookupArgs("docmost"), [
    "ps",
    "-q",
    "docmost",
  ]);
});

test("preserves the primary migration error when automatic rollback fails", () => {
  assert.deepEqual(
    buildMigrationFailureReport({
      migrationId: "20260816",
      error: new Error("candidate inventory differs"),
      rollbackError: new Error("legacy compose race"),
      failedAt: "2026-08-16T08:30:00.000Z",
    }),
    {
      migrationId: "20260816",
      phase: "failed",
      failedAt: "2026-08-16T08:30:00.000Z",
      error: "candidate inventory differs",
      rollback: { status: "failed", error: "legacy compose race" },
    },
  );
});

test("accepts pnpm's documented argument separator", () => {
  assert.deepEqual(parseArguments(["--", "preflight", "--json"]), {
    command: "preflight",
    composeFile: "compose.production.yml",
    envFile: "/etc/docmost/docmost.env",
    stateFile: "/var/lib/docmost/deployment/postgres.env",
    backupDir: "/var/backups/docmost/postgres",
    json: true,
    yes: false,
  });
});

test("parses deployment state without expanding shell syntax", () => {
  assert.deepEqual(
    parseEnvFile(
      "POSTGRES_VOLUME_NAME=docmost_db_data\nMIGRATION_PHASE='ready'\n",
    ),
    {
      POSTGRES_VOLUME_NAME: "docmost_db_data",
      MIGRATION_PHASE: "ready",
    },
  );
});

test("serializes only safe non-secret deployment state values", () => {
  assert.equal(
    serializeEnvFile({
      POSTGRES_VOLUME_NAME: "docmost_db_data",
      MIGRATION_PHASE: "acceptance",
    }),
    "MIGRATION_PHASE=acceptance\nPOSTGRES_VOLUME_NAME=docmost_db_data\n",
  );
  assert.throws(
    () => serializeEnvFile({ VALUE: "$(unsafe)" }),
    /unsupported characters/u,
  );
});

test("rollback state restores both application and PostgreSQL images", () => {
  assert.deepEqual(
    rollbackState(
      { state: { MIGRATION_PHASE: "acceptance" } },
      "docmost-postgres-16",
      `shererpro/docmost@sha256:${"a".repeat(64)}`,
      `postgres@sha256:${"b".repeat(64)}`,
      "20260816",
    ),
    {
      DOCMOST_IMAGE: `shererpro/docmost@sha256:${"a".repeat(64)}`,
      POSTGRES_IMAGE: `postgres@sha256:${"b".repeat(64)}`,
      POSTGRES_VOLUME_NAME: "docmost-postgres-16",
      MIGRATION_ID: "20260816",
      MIGRATION_PHASE: "rolled_back",
    },
  );
});

test("rollback accepts only the recorded safe source preflight class", () => {
  assert.equal(rollbackPreflightMatches({ exitCode: 20 }, 20), true);
  assert.equal(rollbackPreflightMatches({ exitCode: 0 }, 20), false);
  assert.equal(rollbackPreflightMatches({ exitCode: 30 }, 30), false);
  assert.equal(rollbackPreflightMatches({ exitCode: 40 }, 40), false);
});

test("rollback can resume after its external hook was interrupted", () => {
  assert.equal(rollbackPhaseCanRun("acceptance"), true);
  assert.equal(rollbackPhaseCanRun("rollback_preflight"), true);
  assert.equal(rollbackPhaseCanRun("rolled_back"), false);
  assert.equal(rollbackPhaseCanRun("accepted"), false);
});

test("a rolled-back migration retries with the configured target image", () => {
  const state = {
    DOCMOST_IMAGE: `shererpro/docmost@sha256:${"b".repeat(64)}`,
    MIGRATION_PHASE: "rolled_back",
    POSTGRES_VOLUME_NAME: "docmost-postgres-16",
  };
  assert.deepEqual(migrationRetryState(state), {
    MIGRATION_PHASE: "rolled_back",
    POSTGRES_VOLUME_NAME: "docmost-postgres-16",
  });
  assert.equal(
    migrationRetryState({ ...state, MIGRATION_PHASE: "acceptance" })
      .DOCMOST_IMAGE,
    state.DOCMOST_IMAGE,
  );
});

test("read-only retry checks use the configured target image", () => {
  const state = {
    DOCMOST_IMAGE: `shererpro/docmost@sha256:${"b".repeat(64)}`,
    MIGRATION_PHASE: "rolled_back",
    POSTGRES_VOLUME_NAME: "docmost-postgres-16",
  };
  assert.equal(commandState("preflight", state).DOCMOST_IMAGE, undefined);
  assert.equal(commandState("plan", state).DOCMOST_IMAGE, undefined);
  assert.equal(commandState("rollback", state), state);
  assert.equal(commandState("accept", state), state);
});

test("archives root-owned storage with a privileged one-shot process", () => {
  assert.deepEqual(
    storageArchiveDockerArgs({
      storageVolume: "docmost_storage",
      migrationDir: "/var/backups/docmost/postgres/20260816",
      image: `shererpro/docmost@sha256:${"a".repeat(64)}`,
    }),
    [
      "run",
      "--rm",
      "--user",
      "0:0",
      "--mount",
      "type=volume,src=docmost_storage,dst=/source,readonly",
      "--mount",
      "type=bind,src=/var/backups/docmost/postgres/20260816,dst=/backup",
      "--entrypoint",
      "tar",
      `shererpro/docmost@sha256:${"a".repeat(64)}`,
      "-C",
      "/source",
      "-czf",
      "/backup/storage.tar.gz",
      ".",
    ],
  );
});

test("requires capacity for both backup and candidate volume", () => {
  const blocked = buildCapacityPlan({
    databaseBytes: 1000,
    storageBytes: 2000,
    backupFreeBytes: 100,
    dockerFreeBytes: 100,
    rehearsalSeconds: 60,
  });
  assert.equal(blocked.capacityOk, false);
  assert.equal(blocked.estimatedDowntimeSeconds, 990);

  const ready = buildCapacityPlan({
    databaseBytes: 1000,
    storageBytes: 2000,
    backupFreeBytes: 10000,
    dockerFreeBytes: 10000,
    rehearsalSeconds: 60,
  });
  assert.equal(ready.capacityOk, true);
});

test("compares restored database inventories by invariant", () => {
  const inventory = {
    tables: { "public.pages": 12 },
    sequences: { "public.pages_id_seq": "12" },
    extensions: { pg_trgm: "1.6" },
    largeObjects: 0,
    notNullColumns: { "public.pages.id": true },
    constraints: { "public.pages.pages_pkey": "PRIMARY KEY (id)" },
    indexes: { "public.pages_pkey": "CREATE UNIQUE INDEX pages_pkey" },
    unvalidatedConstraints: 0,
    invalidIndexes: 0,
  };
  assert.deepEqual(
    compareInventories(inventory, structuredClone(inventory)),
    [],
  );
  assert.deepEqual(
    compareInventories(inventory, {
      ...inventory,
      tables: { "public.pages": 11 },
    }),
    ["tables"],
  );
  assert.deepEqual(
    compareInventories(inventory, {
      ...inventory,
      notNullColumns: {},
    }),
    ["notNullColumns"],
  );
});
