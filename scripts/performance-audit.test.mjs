import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGates, percentile, summarize } from "./performance-audit.mjs";

test("calculates nearest-rank percentiles deterministically", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
  assert.deepEqual(summarize([]), {
    count: 0,
    p50: null,
    p75: null,
    p95: null,
    p99: null,
    max: null,
  });
});

test("evaluates browser, memory, batching, and 50-session API gates", () => {
  const evaluation = evaluateGates(
    {
      warm: {
        contentVisibleMs: { p75: 1000 },
        editableMs: { p75: 2000 },
        tbtMs: { p75: 300 },
        maxLongTaskMs: 150,
      },
      navigationCycles: { growthRatio: 0.1, monotonicallyIncreasing: false },
      initialNetwork: { references: 1, pageInfo: 1, comments: 0 },
    },
    {
      stages: [
        { sessions: 50, all: { p95: 250, p99: 700 }, failures: [] },
      ],
    },
    { browser: { warm: { tbtMs: { p75: 600 } } } },
  );

  assert.ok(Object.values(evaluation.gates).every(Boolean));
  assert.equal(evaluation.relativeTbtImprovement, 0.5);
});

test("fails gates when required metrics are unavailable", () => {
  const evaluation = evaluateGates(
    {
      warm: {
        contentVisibleMs: { p75: null },
        editableMs: { p75: null },
        tbtMs: { p75: null },
        maxLongTaskMs: null,
      },
      navigationCycles: { growthRatio: null, monotonicallyIncreasing: false },
      initialNetwork: { references: 0, pageInfo: 0, comments: 0 },
    },
    { stages: [] },
    null,
  );

  assert.equal(evaluation.gates.warmContentVisibleP75, false);
  assert.equal(evaluation.gates.editableP75, false);
  assert.equal(evaluation.gates.maxLongTask, false);
  assert.equal(evaluation.gates.tbtP75, false);
  assert.equal(evaluation.gates.heapGrowth, false);
  assert.equal(evaluation.gates.apiP95, false);
  assert.equal(evaluation.gates.apiP99, false);
  assert.equal(evaluation.gates.apiFailures, false);
});
