import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapacityPlan,
  compareInventories,
  parseEnvFile,
  serializeEnvFile,
} from "./production-db.mjs";

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
