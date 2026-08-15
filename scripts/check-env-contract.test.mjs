import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const composeSource = readFileSync(join(root, "docker-compose.yml"), "utf8");

function runContractWithCompose(source) {
  const directory = mkdtempSync(join(tmpdir(), "docmost-env-contract-"));
  const composePath = join(directory, "docker-compose.yml");
  writeFileSync(composePath, source, "utf8");

  try {
    return spawnSync(process.execPath, ["scripts/check-env-contract.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DOCMOST_ENV_CONTRACT_COMPOSE_PATH: composePath,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("accepts the checked-in Compose environment contract", () => {
  const result = runContractWithCompose(composeSource);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a missing runtime forwarding entry", () => {
  const result = runContractWithCompose(
    composeSource.replace(/^  SSO_ALLOWED_ENDPOINTS:.*\r?\n/m, ""),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SSO_ALLOWED_ENDPOINTS/);
});

test("rejects an unclassified Compose runtime key", () => {
  const result = runContractWithCompose(
    composeSource.replace(
      /^x-docmost-secrets:/m,
      '  UNDECLARED_RUNTIME_KEY: "${UNDECLARED_RUNTIME_KEY:-}"\n\nx-docmost-secrets:',
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNDECLARED_RUNTIME_KEY/);
});

test("rejects forwarding a host or database-only key to Docmost", () => {
  const result = runContractWithCompose(
    composeSource.replace(
      /^x-docmost-secrets:/m,
      '  POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-}"\n\nx-docmost-secrets:',
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /POSTGRES_PASSWORD/);
});

test("rejects replacing a file-backed secret with a raw environment value", () => {
  const result = runContractWithCompose(
    composeSource.replace(
      "  APP_SECRET_FILE: /run/secrets/docmost_app_secret",
      '  APP_SECRET: "${APP_SECRET:-}"',
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APP_SECRET/);
});

test("rejects forwarding the host collaboration URL into Compose", () => {
  const result = runContractWithCompose(
    composeSource.replace(
      "  COLLAB_INTERNAL_URL: http://collab:3001",
      '  COLLAB_INTERNAL_URL: "${COLLAB_INTERNAL_URL:-http://collab:3001}"',
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /COLLAB_INTERNAL_URL/);
});

test("requires the API to wait for healthy collaboration", () => {
  const result = runContractWithCompose(
    composeSource.replace(
      "      collab:\n        condition: service_healthy\n",
      "",
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /collaboration service health check/);
});
