import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFingerprints,
  normalizeJscpdDuplicates,
  normalizeKnipIssues,
} from "./check-maintenance-audit.mjs";

test("Knip fingerprints ignore source locations and remain deterministic", () => {
  const report = {
    issues: [
      {
        file: "src\\contract.ts",
        exports: [{ name: "PublicContract", line: 5, col: 1, pos: 20 }],
      },
    ],
  };
  assert.deepEqual(normalizeKnipIssues(report), [
    "exports|src/contract.ts|PublicContract",
  ]);
});

test("duplicate fingerprints are independent from source order and locations", () => {
  const report = {
    duplicates: [
      {
        format: "typescript",
        lines: 30,
        tokens: 120,
        firstFile: { name: "z.ts", start: 10, end: 40 },
        secondFile: { name: "a.ts", start: 2, end: 32 },
      },
    ],
  };
  assert.deepEqual(normalizeJscpdDuplicates(report), [
    "typescript|a.ts|z.ts|30|120",
  ]);
});

test("baseline comparison reports both added and resolved findings", () => {
  assert.deepEqual(compareFingerprints(["kept", "added"], ["kept", "old"]), {
    added: ["added"],
    resolved: ["old"],
  });
});
