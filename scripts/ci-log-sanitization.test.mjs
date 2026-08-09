import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sanitizeLogLine } from "./sanitize-ci-log-stream.mjs";
import { scanArtifacts } from "./scan-ci-artifacts.mjs";

test("redacts credential shapes before artifact persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "docmost-ci-log-"));
  try {
    const sanitized = sanitizeLogLine(
      "user@example.test Bearer secret-token authToken=secret https://example.test?a=1&token=secret",
    );
    await writeFile(join(root, "server.log"), sanitized, "utf8");

    assert.doesNotMatch(sanitized, /user@example\.test|secret-token/u);
    assert.deepEqual(await scanArtifacts(root, ["canary-secret"]), []);

    await writeFile(join(root, "unsafe.log"), "Bearer canary-secret", "utf8");
    const findings = await scanArtifacts(root, ["canary-secret"]);
    assert.equal(findings.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
