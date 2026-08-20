import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseForkDocument,
  validateForkDocsContract,
  validateForkSourceContracts,
} from "./check-fork-docs-contract.mjs";

const contract = JSON.parse(
  await readFile("docs/fork-specific-enhancements-contract.json", "utf8"),
);
const english = await readFile("README.md", "utf8");
const russian = await readFile("FORK_SPECIFIC_ENHANCEMENTS_RU.md", "utf8");
const sources = {
  tags: await readFile("packages/editor-ext/src/lib/tag/utils.ts", "utf8"),
  search: await readFile(
    "apps/server/src/core/search/dto/search.dto.ts",
    "utf8",
  ),
  ragContract: await readFile("packages/api-contract/src/rag.ts", "utf8"),
  ragSync: await readFile(
    "apps/server/src/core/rag-sync/integration/rag-sync-source.service.ts",
    "utf8",
  ),
  archiveContract: await readFile(
    "packages/api-contract/src/docmost-archive.ts",
    "utf8",
  ),
  knowledgeMigration: await readFile(
    "apps/server/src/database/migrations/20260820T130000-knowledge-projection-dictionary-search.ts",
    "utf8",
  ),
  searchMigration: await readFile(
    "apps/server/src/database/migrations/20260820T140000-search-dictionary-database-projection.ts",
    "utf8",
  ),
};

function validate(overrides = {}) {
  return validateForkDocsContract({
    contract,
    english,
    russian,
    ...overrides,
  });
}

test("accepts the synchronized fork documentation", () => {
  assert.deepEqual(validate(), []);
});

test("parses only the fork-specific part of the English README", () => {
  const parsed = parseForkDocument(english, "en");
  assert.equal(parsed.sections.length, 16);
  assert.equal(parsed.sections.at(-1)?.images.length, 1);
  assert.doesNotMatch(parsed.forkSource, /^# Docmost$/mu);
});

test("rejects a missing administrator-guide anchor", () => {
  const errors = validate({ english: english.replace("`#rag-api`,", "") });
  assert.ok(errors.includes("en administrator guide is missing #rag-api"));
});

test("rejects a missing translated semantic concept", () => {
  const errors = validate({
    russian: russian.replace("семь базовых операций чтения", "операции чтения"),
  });
  assert.ok(
    errors.some((error) =>
      error.includes(
        "ru section 3 is missing required concept mcp-baseline-capabilities",
      ),
    ),
  );
});

test("rejects one-sided capability list drift", () => {
  const errors = validate({
    russian: russian.replace(
      "- генерацию словоформ с помощью LLM",
      "генерацию словоформ с помощью LLM",
    ),
  });
  assert.ok(
    errors.some((error) => error.includes("section 7 bullet count mismatch")),
  );
});

test("rejects mismatched paired images", () => {
  const errors = validate({
    russian: russian.replace("/ru/search-indexing.png", "/ru/search.png"),
  });
  assert.ok(
    errors.some((error) => error.includes("section 8 image basename mismatch")),
  );
});

test("rejects an unversioned fork document", () => {
  const errors = validate({
    english: english.replace(
      `fork-doc-contract-version: ${contract.version}`,
      `fork-doc-contract-version: ${contract.version - 1}`,
    ),
  });
  assert.ok(
    errors.includes(
      `en fork document contract version must be ${contract.version}`,
    ),
  );
});

test("rejects missing current release capabilities", () => {
  const errors = validate({
    english: english.replace("active `dictionary_term` sources", "sources"),
  });
  assert.ok(
    errors.some((error) =>
      error.includes("missing required concept rag-sync-dictionary-source"),
    ),
  );
});

test("accepts source contracts described by the fork documentation", () => {
  assert.deepEqual(validateForkSourceContracts(sources), []);
});

test("rejects source drift in release-specific capabilities", () => {
  const errors = validateForkSourceContracts({
    ...sources,
    ragSync: sources.ragSync.replace(
      "sourceType: 'dictionary_term'",
      "sourceType: 'removed_dictionary_term'",
    ),
    knowledgeMigration: `${sources.knowledgeMigration}\nCREATE INDEX stale_index;`,
  });
  assert.ok(errors.includes("RAG Sync must project dictionary_term sources"));
  assert.ok(
    errors.includes("the 130000 knowledge migration must not create indexes"),
  );
});
