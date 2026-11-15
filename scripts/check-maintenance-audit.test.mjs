import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFingerprints,
  normalizeJscpdDuplicates,
  normalizeKnipIssues,
  validateKnipReviewGroups,
  maintenanceReviewWindow,
} from "./check-maintenance-audit.mjs";

test("new maintenance reviews use the actual UTC date and a bounded 30-day deadline", () => {
  assert.deepEqual(maintenanceReviewWindow(new Date("2026-11-15T23:59:00Z")), {
    reviewedAt: "2026-11-15",
    reviewBy: "2026-12-15",
  });
  assert.deepEqual(maintenanceReviewWindow(new Date("2026-12-15T00:00:00Z")), {
    reviewedAt: "2026-12-15",
    reviewBy: "2027-01-14",
  });
});

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

test("Knip review groups provide one owner and review path per finding", () => {
  assert.doesNotThrow(() =>
    validateKnipReviewGroups(
      [
        "exports|apps/client/src/feature.ts|publicFeature",
        "types|apps/server/src/database/types/entity.types.ts|Entity",
      ],
      [
        {
          id: "client",
          owner: "apps/client",
          classification: "reusable-contract",
          rationale: "Reviewed against client consumers before removal.",
          pathPattern: "^apps/client/",
          reviewBy: "2026-11-14",
        },
        {
          id: "database",
          owner: "apps/server/src/database/types",
          classification: "generated-contract",
          rationale: "Reviewed after database type regeneration.",
          pathPattern: "^apps/server/src/database/types/",
          reviewBy: "2026-11-14",
        },
      ],
      new Date("2026-08-14T00:00:00Z"),
    ),
  );
});

test("Knip review groups reject uncovered and overlapping findings", () => {
  const group = {
    id: "client",
    owner: "apps/client",
    classification: "reusable-contract",
    rationale: "Reviewed against client consumers before removal.",
    pathPattern: "^apps/client/",
    reviewBy: "2026-11-14",
  };
  assert.throws(
    () =>
      validateKnipReviewGroups(
        ["exports|apps/server/src/feature.ts|publicFeature"],
        [group],
        new Date("2026-08-14T00:00:00Z"),
      ),
    /exactly one review group \(0 matched\)/,
  );
  assert.throws(
    () =>
      validateKnipReviewGroups(
        ["exports|apps/client/src/feature.ts|publicFeature"],
        [group, { ...group, id: "client-overlap" }],
        new Date("2026-08-14T00:00:00Z"),
      ),
    /exactly one review group \(2 matched\)/,
  );
});
