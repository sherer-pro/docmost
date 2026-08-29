import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProductionDatabaseContract } from "./check-production-db-contract.mjs";
import { POSTGRES_IMAGE } from "./production-db.mjs";

async function fixture() {
  const [localCompose, productionCompose, typesenseCompose, ciSource] =
    await Promise.all([
    readFile("docker-compose.yml", "utf8"),
    readFile("compose.production.yml", "utf8"),
    readFile("compose.typesense.yml", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8"),
    ]);
  return { localCompose, productionCompose, typesenseCompose, ciSource };
}

test("checked-in production database contract is valid", async () => {
  assert.deepEqual(validateProductionDatabaseContract(await fixture()), []);
});

test("rejects Alpine and digest drift", async () => {
  const input = await fixture();
  input.localCompose = input.localCompose.replace(
    POSTGRES_IMAGE,
    `postgres:18-alpine@sha256:${"b".repeat(64)}`,
  );
  const errors = validateProductionDatabaseContract(input);
  assert.ok(errors.some((error) => error.includes("must not use the Alpine")));
  assert.ok(errors.some((error) => error.includes("must match")));
});

test("rejects a fail-open production startup chain", async () => {
  const input = await fixture();
  input.productionCompose = input.productionCompose.replace(
    /(db-preflight:\r?\n\s+)condition: service_completed_successfully/u,
    "$1condition: service_started",
  );
  assert.ok(
    validateProductionDatabaseContract(input).some((error) =>
      error.includes("db-migrate must wait"),
    ),
  );
});

test("requires the recorded PostgreSQL image rollback override", async () => {
  const input = await fixture();
  input.productionCompose = input.productionCompose.replace(
    `\${POSTGRES_IMAGE:-${POSTGRES_IMAGE}}`,
    POSTGRES_IMAGE,
  );
  assert.ok(
    validateProductionDatabaseContract(input).some((error) =>
      error.includes("rollback PostgreSQL image"),
    ),
  );
});

test("requires the hardened private Typesense production overlay", async () => {
  const input = await fixture();
  input.typesenseCompose = input.typesenseCompose
    .replace("mem_limit: 512m", "mem_limit: 2g")
    .replace("--thread-pool-size=8", "")
    .replace(/    cap_drop:\r?\n      - ALL\r?\n/u, "")
    .replace(
      /    healthcheck:\r?\n/u,
      "    ports:\n      - \"8108:8108\"\n    healthcheck:\n",
    );
  const errors = validateProductionDatabaseContract(input);
  assert.ok(errors.some((error) => error.includes("mem_limit: 512m")));
  assert.ok(errors.some((error) => error.includes("--thread-pool-size=8")));
  assert.ok(errors.some((error) => error.includes("cap_drop:")));
  assert.ok(errors.some((error) => error.includes("must not publish port")));
});
