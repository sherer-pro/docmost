import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseGateContract } from "./check-release-gates.mjs";

const validCi = `on:
  workflow_call:
jobs:
  validate:
    runs-on: ubuntu-latest
  integration:
    needs: validate
  production-smoke:
    needs: integration
`;

const validDocker = `jobs:
  gates:
    uses: ./.github/workflows/ci.yml
  publish:
    needs: gates
`;

test("accepts the publish to gates to production-smoke chain", () => {
  assert.deepEqual(
    validateReleaseGateContract({
      ciSource: validCi,
      dockerSource: validDocker,
    }),
    [],
  );
});

test("a failed-smoke bypass cannot publish", () => {
  const errors = validateReleaseGateContract({
    ciSource: validCi.replace("    needs: integration", "    needs: validate"),
    dockerSource: validDocker.replace("    needs: gates", "    if: always()"),
  });

  assert.ok(errors.includes("production-smoke must need integration"));
  assert.ok(errors.includes("publish must need gates"));
  assert.ok(
    errors.includes("publish must not bypass failed gates with always()"),
  );
});
