import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapacityPlan,
  compareInventories,
  parseArguments,
  parseEnvFile,
  rollbackPreflightMatches,
  rollbackState,
  serializeEnvFile,
} from "./production-db.mjs";

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
});
