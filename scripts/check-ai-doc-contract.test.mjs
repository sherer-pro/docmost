import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAiGuideDiffContract,
  isAiGuideLogicPath,
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
