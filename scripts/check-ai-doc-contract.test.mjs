import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_GUIDE_MIGRATION_FILES,
  evaluateAiGuideDiffContract,
  isAiGuideLogicPath,
  validateAiGuideRequiredFacts,
  validateAiGuideUiContract,
} from "./check-ai-doc-contract.mjs";

const locales = [
  "de-DE",
  "en-US",
  "es-ES",
  "fr-FR",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "nl-NL",
  "pt-BR",
  "ru-RU",
  "uk-UA",
  "zh-CN",
];
const requiredChanges = [
  "docs/AI_ASSISTANT_AND_RAG.md",
  "apps/client/src/features/ai/components/ai-admin-guide-content.ts",
  "apps/client/src/features/ai/components/ai-admin-guide-contract.json",
  ...locales.map(
    (locale) => `apps/client/public/locales/${locale}/translation.json`,
  ),
];
const uiInputs = {
  appRoutes: await readFile("apps/client/src/App.tsx", "utf8"),
  aiSettingsPage: await readFile(
    "apps/client/src/features/ai/pages/ai-integrations-settings.tsx",
    "utf8",
  ),
  settingsAccess: await readFile(
    "apps/client/src/components/settings/workspace-settings-access.ts",
    "utf8",
  ),
  guideBrowserAcceptance: await readFile(
    "apps/client/e2e/ai/specs/admin-guide.spec.ts",
    "utf8",
  ),
  aiPlaywrightConfig: await readFile(
    "apps/client/playwright.ai.config.ts",
    "utf8",
  ),
};

test("accepts a coupled AI logic and guide contract update", () => {
  const errors = evaluateAiGuideDiffContract({
    changedPaths: [
      "apps/server/src/core/ai/ai-config.service.ts",
      ...requiredChanges,
    ],
    supportedLocales: locales,
    baseVersion: 3,
    currentVersion: 4,
  });
  assert.deepEqual(errors, []);
});

test("treats internal production refactors as guide-relevant", () => {
  assert.equal(
    isAiGuideLogicPath("apps/server/src/core/rag/rag.service.ts"),
    true,
  );
  const errors = evaluateAiGuideDiffContract({
    changedPaths: ["apps/server/src/core/rag/rag.service.ts"],
    supportedLocales: locales,
    baseVersion: 3,
    currentVersion: 3,
  });
  assert.ok(errors.some((error) => error.includes("required guide file")));
  assert.ok(errors.some((error) => error.includes("increment by exactly one")));
});

test("ignores tests and documentation-only changes", () => {
  for (const changedPath of [
    "apps/server/src/core/mcp/mcp.controller.test.ts",
    "apps/client/src/features/ai/e2e/guide.spec.ts",
    "docs/AI_INTEGRATION.md",
  ]) {
    assert.equal(isAiGuideLogicPath(changedPath), false);
  }
  assert.deepEqual(
    evaluateAiGuideDiffContract({
      changedPaths: ["apps/server/src/core/mcp/mcp.controller.test.ts"],
      supportedLocales: locales,
      baseVersion: 3,
      currentVersion: 3,
    }),
    [],
  );
});

test("rejects one missing locale update", () => {
  const errors = evaluateAiGuideDiffContract({
    changedPaths: [
      "apps/server/src/core/api-key/api-key.service.ts",
      ...requiredChanges.filter((filePath) => !filePath.includes("/ja-JP/")),
    ],
    supportedLocales: locales,
    baseVersion: 3,
    currentVersion: 4,
  });
  assert.ok(errors.includes("AI logic changed without updating locale: ja-JP"));
});

test("rejects a skipped or mismatched guide contract version", () => {
  for (const currentVersion of [3, 5]) {
    const errors = evaluateAiGuideDiffContract({
      changedPaths: ["packages/api-contract/src/ai.ts", ...requiredChanges],
      supportedLocales: locales,
      baseVersion: 3,
      currentVersion,
    });
    assert.ok(
      errors.includes(
        `AI guide contract version must increment by exactly one: 3 -> ${currentVersion}`,
      ),
    );
  }
});

test("accepts the separate administrator-only AI guide release surface", () => {
  assert.deepEqual(validateAiGuideUiContract(uiInputs), []);
});

test("rejects an AI guide route outside the administrator boundary", () => {
  const errors = validateAiGuideUiContract({
    ...uiInputs,
    appRoutes: uiInputs.appRoutes.replace(
      '<Route path={"ai/:aiTab"} element={<AiIntegrationsSettings />} />',
      '<Route path={"removed"} element={<AiIntegrationsSettings />} />',
    ),
  });
  assert.ok(
    errors.includes(
      "AI guide route must remain inside the workspace-administrator route boundary",
    ),
  );
});

test("rejects removal of the separate AI guide tab", () => {
  const errors = validateAiGuideUiContract({
    ...uiInputs,
    aiSettingsPage: uiInputs.aiSettingsPage.replace(
      'value="guide"',
      'value="removed-guide"',
    ),
  });
  assert.ok(errors.includes("AI guide must remain a separate AI settings tab"));
});

test("rejects incomplete bilingual browser acceptance", () => {
  const errors = validateAiGuideUiContract({
    ...uiInputs,
    guideBrowserAcceptance: uiInputs.guideBrowserAcceptance.replaceAll(
      '"rag-sync"',
      '"removed-rag-sync"',
    ),
    aiPlaywrightConfig: uiInputs.aiPlaywrightConfig.replace("admin-guide|", ""),
  });
  assert.ok(
    errors.includes("AI guide browser acceptance is missing anchor: rag-sync"),
  );
  assert.ok(
    errors.includes(
      "AI guide browser acceptance must run in the English project",
    ),
  );
});

test("keeps the current knowledge projection migrations in the AI ledger", () => {
  for (const migration of [
    "20260811T190000-rag-sync-target-verification.ts",
    "20260820T130000-knowledge-projection-dictionary-search.ts",
    "20260820T140000-search-dictionary-database-projection.ts",
  ]) {
    assert.ok(AI_GUIDE_MIGRATION_FILES.includes(migration));
  }
});

test("rejects a missing localized operational fact", () => {
  const guideContract = {
    requiredKeys: ["scenario.ragSync.technical"],
    requiredFacts: [
      {
        id: "rag-sync-source-union",
        key: "scenario.ragSync.technical",
        needles: ["/api/rag/*", "dictionary_term"],
      },
    ],
  };
  assert.deepEqual(
    validateAiGuideRequiredFacts({
      guideContract,
      localeGuides: {
        "en-US": {
          "scenario.ragSync.technical":
            "Uses /api/rag/* only as a boundary and includes dictionary_term.",
        },
      },
    }),
    [],
  );
  const errors = validateAiGuideRequiredFacts({
    guideContract,
    localeGuides: {
      "en-US": {
        "scenario.ragSync.technical": "Uses /api/rag/* only as a boundary.",
      },
    },
  });
  assert.ok(
    errors.includes(
      "en-US AI guide fact rag-sync-source-union is missing from scenario.ragSync.technical: dictionary_term",
    ),
  );
});
