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
  aiAgentAuditSource,
  aiAgentSpecSource,
  aiAgentComposeSource,
  migrationSource,
  editorMobileSource,
  aiContextAuditSource,
  dockerfileSource,
] = await Promise.all([
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/docker.yml", "utf8"),
  readFile(".github/workflows/rag-open-webui-compat.yml", "utf8"),
  readFile("package.json", "utf8"),
  readFile("apps/client/e2e/ai/run-ai-audit.mjs", "utf8"),
  readFile("apps/client/e2e/ai/support.ts", "utf8"),
  readFile("apps/client/e2e/ai/specs/provider-settings.spec.ts", "utf8"),
  readFile("apps/client/e2e/ai-agent/run-ai-agent-audit.mjs", "utf8"),
  readFile("apps/client/e2e/ai-agent/specs/agent-mode.audit.spec.ts", "utf8"),
  readFile("apps/client/e2e/ai-agent/docker-compose.audit.yml", "utf8"),
  readFile("apps/server/src/database/migrate.ts", "utf8"),
  readFile("apps/client/e2e/editor/specs/mobile-accessibility.spec.ts", "utf8"),
  readFile("apps/client/e2e/ai-context/run-ai-context-audit.mjs", "utf8"),
  readFile("Dockerfile", "utf8"),
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
    dockerfileSource: overrides.dockerfileSource ?? dockerfileSource,
  };
}

test("accepts the checked-in release gate contract", () => {
  assert.deepEqual(validateReleaseGateContract(inputs()), []);
});

test("AI documentation gate keeps full history and base/head revisions", () => {
  for (const [needle, expectedError] of [
    [
      "          fetch-depth: 0",
      "validate checkout must use fetch-depth: 0 for AI guide diff checks",
    ],
    [
      "          AI_GUIDE_BASE_SHA:",
      "AI documentation gate must receive AI_GUIDE_BASE_SHA",
    ],
    [
      "          AI_GUIDE_HEAD_SHA:",
      "AI documentation gate must receive AI_GUIDE_HEAD_SHA",
    ],
  ]) {
    const mutated = ciSource.replace(
      needle,
      `          REMOVED_${needle.trim()}`,
    );
    assert.notEqual(mutated, ciSource, `fixture must contain ${needle}`);
    const errors = validateReleaseGateContract(inputs({ ciSource: mutated }));
    assert.ok(errors.includes(expectedError));
  }
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
  assert.match(
    aiSupportSource,
    /data: \{ locale, aiPanelOpen: false \}/u,
    "each browser case must start with the shared admin panel closed",
  );
});

test("AI browser API setup binds the transport host to the CSRF origin", () => {
  assert.match(aiAuditSource, /const apiHost = new URL\(apiOrigin\)\.host/u);
  assert.equal(
    aiAuditSource.match(/Host: apiHost,/gu)?.length,
    2,
    "admin and invited-member setup must use the trusted API host",
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

test("editor mobile acceptance isolates the shared assistant state", () => {
  assert.equal(
    editorMobileSource.match(/aiPanelOpen: false,/gu)?.length,
    2,
    "each mobile scenario must start with the assistant closed",
  );
  assert.equal(
    editorMobileSource.match(/aiPanelOpen: original\.aiPanelOpen \?\? false,/gu)
      ?.length,
    2,
    "each mobile scenario must restore the original assistant state",
  );
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

test("AI context acceptance finds its member beyond the first page", () => {
  assert.match(
    aiContextAuditSource,
    /workspace\/members\?limit=100&query=\$\{encodeURIComponent\(email\)\}/u,
  );
  assert.match(
    aiContextAuditSource,
    /await api\(admin, "DELETE", `\/api\/spaces\/\$\{space\.id\}`\)/u,
  );
  assert.match(aiContextAuditSource, /state\.retained = false/u);
  assert.match(
    aiContextAuditSource,
    /state\.deletedAt = new Date\(\)\.toISOString\(\)/u,
  );
});

test("AI Agent acceptance supplies isolated file-backed Compose secrets", () => {
  assert.match(
    aiAgentAuditSource,
    /DATABASE_URL: databaseUrl,[\s\S]*REDIS_URL: redisUrl,/u,
  );
  assert.match(
    aiAgentAuditSource,
    /COLLAB_INTERNAL_SECRET: collabInternalSecret,/u,
  );
  assert.match(
    aiAgentAuditSource,
    /COLLAB_INTERNAL_URL: `http:\/\/collab:\$\{collabPort\}`/u,
  );
  assert.match(
    aiAgentAuditSource,
    /\["collab-internal-secret", collabInternalSecret\]/u,
  );
  assert.match(aiAgentAuditSource, /@toxiproxy:15432\/docmost/u);
  assert.match(
    aiAgentAuditSource,
    /composeArgs\("up", "-d", "docmost", "collab"\)/u,
  );
  assert.match(aiAgentAuditSource, /"isolated collaboration server"/u);
  assert.match(aiAgentAuditSource, /DOCMOST_AI_AGENT_COLLAB_PORT/u);
  assert.match(
    aiAgentSpecSource,
    /memberEditor\.fill\(`STALE_\$\{runId\} concurrent-writer-change`\)/u,
  );
  assert.match(aiAgentSpecSource, /concurrent writer change to persist/u);
  assert.match(
    aiAgentAuditSource,
    /createRequire\(import\.meta\.url\)\.resolve\("@playwright\/test\/cli"\)/u,
  );
  assert.doesNotMatch(
    aiAgentAuditSource,
    /shell:\s*process\.platform\s*===\s*"win32"/u,
  );
  assert.match(
    aiAgentAuditSource,
    /process\.env\.DOCMOST_AI_AGENT_AUDIT_ROOT/u,
  );
  assert.doesNotMatch(aiAgentComposeSource, /^\s+DATABASE_URL:/mu);
  assert.doesNotMatch(aiAgentComposeSource, /^\s+REDIS_URL:/mu);
});

test("production migrations resolve file-backed secrets before connecting", () => {
  const resolve = migrationSource.indexOf(
    "resolveEnvironmentFileSecrets(process.env)",
  );
  const connect = migrationSource.indexOf(
    "normalizePostgresUrl(process.env.DATABASE_URL)",
  );
  assert.ok(resolve >= 0, "migration CLI must resolve Compose file secrets");
  assert.ok(connect > resolve, "migration CLI must resolve secrets before use");
  assert.match(migrationSource, /if \(fileSecretErrors\.length > 0\)/u);
});

test("production runtime dependencies populate their own offline cache", () => {
  const command = "pnpm fetch --prod --frozen-lockfile";
  assert.ok(dockerfileSource.includes(command), "Dockerfile fixture must fetch");
  const errors = validateReleaseGateContract(
    inputs({
      dockerfileSource: dockerfileSource.replace(command, "removed-fetch"),
    }),
  );
  assert.ok(
    errors.includes(
      "Dockerfile runtime dependencies must be fetched before the offline production install",
    ),
  );
});

const workflowMutations = [
  ["community boundary", "ciSource", "pnpm check:no-ee"],
  ["community boundary tests", "ciSource", "pnpm test:no-ee"],
  ["architecture contract", "ciSource", "pnpm check:architecture"],
  ["release version contract", "ciSource", "pnpm check:release-version"],
  ["release gate self-check", "ciSource", "pnpm check:release-gates"],
  ["build", "ciSource", "pnpm build"],
  ["route inventory", "ciSource", "pnpm routes:inventory:check"],
  ["RAG docs", "ciSource", "pnpm check:rag-docs"],
  ["AI docs", "ciSource", "pnpm check:ai-docs"],
  ["text contracts", "ciSource", "pnpm test:text-contracts"],
  ["environment", "ciSource", "pnpm check:env"],
  ["lint", "ciSource", "pnpm lint"],
  ["client unit", "ciSource", "pnpm --filter ./apps/client test"],
  ["server unit", "ciSource", "pnpm --filter ./apps/server test"],
  ["RAG Sync contract", "ciSource", "pnpm test:rag-sync:contract"],
  ["security", "ciSource", "pnpm test:security"],
  ["comment language", "ciSource", "pnpm check:comments:en"],
  ["audit exceptions", "ciSource", "pnpm check:audit-exceptions"],
  [
    "production dependency audit",
    "ciSource",
    "pnpm audit --prod --audit-level high",
  ],
  ["integration build", "ciSource", "pnpm server:build"],
  [
    "empty database migrations",
    "ciSource",
    "pnpm --filter ./apps/server migration:latest",
  ],
  ["server integration", "ciSource", "pnpm --filter ./apps/server test:e2e"],
  [
    "production image build",
    "ciSource",
    "docker build --build-arg PNPM_OFFLINE=0 -t docmost:ci .",
  ],
  [
    "compiled production smoke",
    "ciSource",
    "node scripts/ci-production-smoke.mjs",
  ],
  ["editor browser", "ciSource", "pnpm test:editor:e2e"],
  [
    "production Draw.io runtime",
    "ciSource",
    "-e DRAWIO_URL=https://embed.diagrams.net",
  ],
  [
    "local Draw.io browser shim",
    "ciSource",
    "DOCMOST_DRAWIO_AUDIT_URL: https://embed.diagrams.net",
  ],
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
  [
    "release manifest version lookup",
    "dockerSource",
    'manifest_version="$(node -p "require(\'./package.json\').version")"',
  ],
  [
    "release tag and manifest equality",
    "dockerSource",
    'test "$tag" = "$expected_tag"',
  ],
  [
    "release image build",
    "dockerSource",
    "docker build --build-arg PNPM_OFFLINE=0",
  ],
  [
    "versioned image publish",
    "dockerSource",
    'docker push "shererpro/docmost:${VERSION}"',
  ],
  [
    "latest image publish",
    "dockerSource",
    "docker push shererpro/docmost:latest",
  ],
  [
    "Open WebUI artifact sanitizer",
    "ragSource",
    "node scripts/sanitize-ci-log-stream.mjs",
  ],
  [
    "Open WebUI artifact scan",
    "ragSource",
    "node scripts/scan-ci-artifacts.mjs output/audit",
  ],
  [
    "Open WebUI sanitized artifact marker",
    "ragSource",
    "if: failure() && hashFiles('output/audit/.sanitized') != ''",
  ],
];

for (const [name, sourceName, command] of workflowMutations) {
  test(`rejects removal of the ${name} gate`, () => {
    const source = { ciSource, dockerSource, ragSource }[sourceName];
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

test("rejects a required workflow command with fail-open handling", () => {
  const mutated = ciSource.replace(
    "        run: pnpm test:security",
    "        run: pnpm test:security || true",
  );
  assert.notEqual(mutated, ciSource, "security command fixture must exist");
  const errors = validateReleaseGateContract(inputs({ ciSource: mutated }));
  assert.ok(
    errors.includes("validate must not mask failures from pnpm test:security"),
  );
});

test("rejects a required workflow command in a disabled step", () => {
  const mutated = ciSource.replace(
    /      - name: Security regression tests\r?\n        run: pnpm test:security/u,
    "      - name: Security regression tests\n        if: false\n        run: pnpm test:security",
  );
  assert.notEqual(mutated, ciSource, "security step fixture must exist");
  const errors = validateReleaseGateContract(inputs({ ciSource: mutated }));
  assert.ok(errors.includes("validate must run pnpm test:security"));
});

test("rejects fail-open command chaining in root verification scripts", () => {
  const mutatedPackage = structuredClone(packageJson);
  mutatedPackage.scripts["verify:quick"] = mutatedPackage.scripts[
    "verify:quick"
  ].replace(
    "&& corepack pnpm run test:security",
    "|| corepack pnpm run test:security",
  );
  const errors = validateReleaseGateContract(
    inputs({ packageJson: mutatedPackage }),
  );
  assert.ok(errors.includes("verify:quick must include run test:security"));
});

for (const [scriptName, command] of [
  ["verify:quick", "run check:release-version"],
  ["verify:quick", "run test:security"],
  ["verify:full", "run check:release-version"],
  ["verify:full", "run build"],
  ["verify:release", "run routes:inventory:check"],
  ["verify:release", "run test:ai:e2e"],
  ["verify:release", "run test:ai-agent:e2e"],
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
