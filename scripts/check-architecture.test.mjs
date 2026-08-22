import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const dependencyCruiser = resolve(
  root,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);

function cruise(paths) {
  return spawnSync(
    process.execPath,
    [dependencyCruiser, "--config", ".dependency-cruiser.cjs", ...paths],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

test("rejects a circular dependency introduced through an internal path", () => {
  const result = cruise([
    "scripts/fixtures/architecture/cycle/apps/client/src",
  ]);

  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /no-circular/);
});

test("rejects a server import of client implementation code", () => {
  const result = cruise([
    "scripts/fixtures/architecture/server-to-client/apps/server/src",
    "scripts/fixtures/architecture/server-to-client/apps/client/src",
  ]);

  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /no-server-to-client/);
});

test("rejects a frontend foundation import of a feature implementation", () => {
  const result = cruise([
    "scripts/fixtures/architecture/client-foundation-to-feature/apps/client/src",
  ]);

  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /no-client-foundation-to-features/);
});

test("rejects a persistence import of core feature implementation", () => {
  const result = cruise([
    "scripts/fixtures/architecture/database-to-core/apps/server/src",
  ]);

  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /no-database-to-core/);
});

test("rejects a dictionary import of AI implementation details", () => {
  const result = cruise([
    "scripts/fixtures/architecture/dictionary-to-ai/apps/server/src",
  ]);

  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /no-dictionary-to-ai-implementation/);
});
