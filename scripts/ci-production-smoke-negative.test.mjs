import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("production smoke exits non-zero when the production target is unavailable", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/ci-production-smoke.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CI_SMOKE_BASE_URL: "http://127.0.0.1:1",
        CI_SMOKE_COLLAB_URL: "http://127.0.0.1:1",
      },
      timeout: 10_000,
    },
  );

  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
});
