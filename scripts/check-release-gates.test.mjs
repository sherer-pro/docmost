import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateReleaseGateContract } from "./check-release-gates.mjs";

const [
  ciSource,
  dockerSource,
  ragSource,
  packageSource,
  aiAuditSource,
  aiSupportSource,
  aiProviderSettingsSource,
] = await Promise.all([
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/docker.yml", "utf8"),
  readFile(".github/workflows/rag-open-webui-compat.yml", "utf8"),
  readFile("package.json", "utf8"),
  readFile("apps/client/e2e/ai/run-ai-audit.mjs", "utf8"),
  readFile("apps/client/e2e/ai/support.ts", "utf8"),
  readFile("apps/client/e2e/ai/specs/provider-settings.spec.ts", "utf8"),
]);
const packageJson = JSON.parse(packageSource);

function inputs(overrides = {}) {
  const workflows = {
    "ci.yml": overrides.ciSource ?? ciSource,
    "docker.yml": overrides.dockerSource ?? dockerSource,
    "rag-open-webui-compat.yml": overrides.ragSource ?? ragSource,
  };
  return {
    ciSource: workflows["ci.yml"],
    dockerSource: workflows["docker.yml"],
    workflowSources: workflows,
    packageJson: overrides.packageJson ?? packageJson,
  };
}

test("accepts the checked-in release gate contract", () => {
  assert.deepEqual(validateReleaseGateContract(inputs()), []);
});

test("AI browser acceptance isolates and restores the admin panel preference", () => {
  const snapshot = aiAuditSource.indexOf("originalAdminAiPanelOpen = Boolean(");
  const normalize = aiAuditSource.indexOf("data: { aiPanelOpen: false }");
  const run = aiAuditSource.indexOf("exitCode = await runPlaywright()");
  const restore = aiAuditSource.indexOf(
    "data: { aiPanelOpen: originalAdminAiPanelOpen }",
  );

  assert.ok(snapshot >= 0, "AI panel preference must be captured");
  assert.ok(normalize > snapshot, "AI panel must be closed before the audit");
  assert.ok(run > normalize, "Playwright must run after panel normalization");
  assert.ok(
    restore > run,
    "AI panel preference must be restored after the audit",
  );
});

test("AI browser acceptance opens the off-screen assistant before use", () => {
  assert.match(aiSupportSource, /openButton\.or\(composer\)\.first\(\)/u);
  assert.match(aiSupportSource, /if \(asideIsOpen\) \{/u);
  assert.ok(
    aiSupportSource.indexOf("if (asideIsOpen) {") <
      aiSupportSource.indexOf("if (composerInViewport) return"),
    "the logical panel state must be checked before transition geometry",
  );
  assert.match(aiSupportSource, /if \(composerInViewport\) return/u);
  assert.match(
    aiSupportSource,
    /not\.toHaveAttribute\("aria-hidden", "true"\)/u,
  );
  assert.match(aiSupportSource, /expect\(composer\)\.toBeInViewport\(\)/u);
});

test("AI provider acceptance follows the configured mock origin", () => {
  assert.match(
    aiProviderSettingsSource,
    /process\.env\.DOCMOST_AI_PROVIDER_BASE_URL/u,
  );
  assert.doesNotMatch(
    aiProviderSettingsSource,
    /toHaveValue\(\/host\\\.docker\\\.internal:1080\//u,
  );
});

const workflowMutations = [
  ["community boundary", "ciSource", "pnpm check:no-ee"],
  ["build", "ciSource", "pnpm build"],
  ["route inventory", "ciSource", "pnpm routes:inventory:check"],
  ["RAG docs", "ciSource", "pnpm check:rag-docs"],
  ["AI docs", "ciSource", "pnpm check:ai-docs"],
  ["environment", "ciSource", "pnpm check:env"],
  ["lint", "ciSource", "pnpm lint"],
  ["client unit", "ciSource", "pnpm --filter ./apps/client test"],
  ["server unit", "ciSource", "pnpm --filter ./apps/server test"],
  ["security", "ciSource", "pnpm test:security"],
  ["audit exceptions", "ciSource", "pnpm check:audit-exceptions"],
  [
    "production dependency audit",
    "ciSource",
    "pnpm audit --prod --audit-level high",
  ],
  [
    "empty database migrations",
    "ciSource",
    "pnpm --filter ./apps/server migration:latest",
  ],
  ["server integration", "ciSource", "pnpm --filter ./apps/server test:e2e"],
  [
    "compiled production smoke",
    "ciSource",
    "node scripts/ci-production-smoke.mjs",
  ],
  ["editor browser", "ciSource", "pnpm test:editor:e2e"],
  ["AI browser", "ciSource", "pnpm test:ai:e2e"],
  ["AI context browser", "ciSource", "pnpm test:ai-context:e2e"],
  [
    "RAG resume",
    "ciSource",
    "node scripts/ci-embedded-rag-sync-smoke.mjs resume",
  ],
  [
    "artifact scan",
    "ciSource",
    "node scripts/scan-ci-artifacts.mjs ci-artifacts",
  ],
  [
    "sanitized artifact marker",
    "ciSource",
    "if: failure() && hashFiles('ci-artifacts/.sanitized') != ''",
  ],
];

for (const [name, sourceName, command] of workflowMutations) {
  test(`rejects removal of the ${name} gate`, () => {
    const source = sourceName === "ciSource" ? ciSource : dockerSource;
    assert.ok(source.includes(command), `${command} fixture must exist`);
    const mutated = source.replace(
      command,
      `removed-${name.replaceAll(" ", "-")}`,
    );
    const errors = validateReleaseGateContract(
      inputs({ [sourceName]: mutated }),
    );
    assert.ok(errors.length > 0);
  });
}

test("rejects a failed-smoke publish bypass", () => {
  const errors = validateReleaseGateContract(
    inputs({
      ciSource: ciSource.replace(
        "    needs: integration",
        "    needs: validate",
      ),
      dockerSource: dockerSource
        .replace("    needs: gates", "    needs: validate")
        .replace(
          "    runs-on: ubuntu-latest",
          "    if: always()\n    runs-on: ubuntu-latest",
        ),
    }),
  );

  assert.ok(errors.includes("production-smoke must need integration"));
  assert.ok(errors.includes("publish must need gates"));
  assert.ok(
    errors.includes("publish must not bypass failed gates with always()"),
  );
});

test("rejects a floating third-party action reference", () => {
  const mutated = ragSource.replace(
    /actions\/checkout@[0-9a-f]{40}/u,
    "actions/checkout@v4",
  );
  const errors = validateReleaseGateContract(inputs({ ragSource: mutated }));
  assert.ok(errors.some((error) => error.includes("immutable 40-character")));
});

test("rejects a required command that exists only in a comment", () => {
  const mutated = ciSource.replace(
    "        run: pnpm test:security",
    "        # run: pnpm test:security",
  );
  assert.notEqual(mutated, ciSource, "security command fixture must exist");
  const errors = validateReleaseGateContract(inputs({ ciSource: mutated }));
  assert.ok(errors.includes("validate must run pnpm test:security"));
});

for (const [scriptName, command] of [
  ["verify:quick", "run test:security"],
  ["verify:full", "run build"],
  ["verify:release", "run routes:inventory:check"],
  ["verify:release", "run test:ai:e2e"],
]) {
  test(`rejects ${scriptName} without ${command}`, () => {
    const mutatedPackage = structuredClone(packageJson);
    mutatedPackage.scripts[scriptName] = mutatedPackage.scripts[
      scriptName
    ].replace(command, "removed-command");
    const errors = validateReleaseGateContract(
      inputs({ packageJson: mutatedPackage }),
    );
    assert.ok(
      errors.some((error) => error.includes(`${scriptName} must include`)),
    );
  });
}
