import assert from "node:assert/strict";
import test from "node:test";
import { validateNoProductTelemetry } from "./check-no-product-telemetry.mjs";

test("accepts sources without external product telemetry", () => {
  assert.deepEqual(
    validateNoProductTelemetry({
      "app.ts": "export const health = 'ok';",
      "compose.yml": "NODE_ENV: production",
    }),
    [],
  );
});

for (const [name, source] of [
  ["PostHog package", 'import posthog from "posthog-js";'],
  ["Docmost endpoint", 'const endpoint = "https://tel.docmost.com/api/event";'],
  ["disable switch", "DISABLE_TELEMETRY=true"],
  ["PostHog host", "POSTHOG_HOST=https://example.com"],
  ["PostHog key", "POSTHOG_KEY=example"],
  ["server module", "imports: [TelemetryModule]"],
]) {
  test(`rejects ${name}`, () => {
    assert.ok(validateNoProductTelemetry({ "fixture.txt": source }).length > 0);
  });
}
