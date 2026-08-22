import assert from "node:assert/strict";
import test from "node:test";
import { runAudit } from "./run-nonblocking-audit.mjs";

function silentOutput() {
  return {
    error() {},
    log() {},
    warn() {},
  };
}

test("keeps child findings non-blocking by default and reports their status", () => {
  const result = runAudit("dead-code", {
    spawn: () => ({ status: 1 }),
    platform: "linux",
    output: silentOutput(),
  });

  assert.deepEqual(result, {
    name: "dead-code",
    status: "findings_or_failure",
    childExitCode: 1,
    exitCode: 0,
  });
});

test("makes child findings blocking in strict mode", () => {
  const result = runAudit("duplicates", {
    strict: true,
    spawn: () => ({ status: 1 }),
    platform: "linux",
    output: silentOutput(),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.status, "findings_or_failure");
});

test("distinguishes a missing audit binary and fails it in strict mode", () => {
  const result = runAudit("deps", {
    strict: true,
    spawn: () => ({ status: null, error: new Error("ENOENT") }),
    platform: "linux",
    output: silentOutput(),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.status, "unavailable");
  assert.equal(result.childExitCode, null);
});
