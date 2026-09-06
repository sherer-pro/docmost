import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLineEndings } from "./text-normalization.mjs";

const root = process.cwd();
const CONTRACT_PATH = "docs/fork-specific-enhancements-contract.json";
const ENGLISH_BOUNDARY = "\n---\n\n# Docmost";
const SOURCE_PATHS = {
  tags: "packages/editor-ext/src/lib/tag/utils.ts",
  search: "apps/server/src/core/search/dto/search.dto.ts",
  ragContract: "packages/api-contract/src/rag.ts",
  ragSync: "apps/server/src/core/rag-sync/integration/rag-sync-source.service.ts",
  archiveContract: "packages/api-contract/src/docmost-archive.ts",
  knowledgeMigration:
    "apps/server/src/database/migrations/20260820T130000-knowledge-projection-dictionary-search.ts",
  searchMigration:
    "apps/server/src/database/migrations/20260820T140000-search-dictionary-database-projection.ts",
};
const EXPECTED_BUILT_IN_TAGS = [
  "tbd",
  "todo",
  "done",
  "core",
  "future",
  "pilot",
];

function normalizeText(value) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function includesConcept(source, concept) {
  return normalizeText(source).includes(normalizeText(concept));
}

export function parseForkDocument(source, locale) {
  const normalized = normalizeLineEndings(source);
  const boundary = locale === "en" ? normalized.indexOf(ENGLISH_BOUNDARY) : -1;
  const forkSource = boundary >= 0 ? normalized.slice(0, boundary) : normalized;
  const matches = [...forkSource.matchAll(/^### (\d+)\. (.+)$/gmu)];
  const firstSectionIndex = matches[0]?.index ?? forkSource.length;
  const guideSource = forkSource.slice(0, firstSectionIndex);
  const sections = matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? forkSource.length;
    const body = forkSource.slice(start, end);
    const images = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map(
      (image) => image[1],
    );
    return {
      number: Number(match[1]),
      heading: match[2].trim(),
      body,
      bulletCount: [...body.matchAll(/^- /gmu)].length,
      images,
    };
  });
  return { forkSource, guideSource, sections };
}

function validateConcepts(issues, source, concepts, locale, scope) {
  for (const concept of concepts) {
    if (!includesConcept(source, concept[locale])) {
      issues.push(
        `${locale} ${scope} is missing required concept ${concept.id}: ${concept[locale]}`,
      );
    }
  }
}

export function validateForkDocsContract({ contract, english, russian }) {
  const issues = [];
  const documents = {
    en: parseForkDocument(english, "en"),
    ru: parseForkDocument(russian, "ru"),
  };

  for (const [locale, source] of [
    ["en", english],
    ["ru", russian],
  ]) {
    const version = /fork-doc-contract-version:\s*(\d+)/u.exec(source)?.[1];
    if (Number(version) !== contract.version) {
      issues.push(
        `${locale} fork document contract version must be ${contract.version}`,
      );
    }
    const guideHeading = `## ${contract.guide.headings[locale]}`;
    if (!documents[locale].guideSource.includes(guideHeading)) {
      issues.push(`${locale} fork document is missing ${guideHeading}`);
    }
    for (const anchor of contract.guide.anchors) {
      if (!documents[locale].guideSource.includes(`#${anchor}`)) {
        issues.push(`${locale} administrator guide is missing #${anchor}`);
      }
    }
    validateConcepts(
      issues,
      documents[locale].guideSource,
      contract.guide.requiredConcepts,
      locale,
      "administrator guide",
    );
  }

  if (!english.includes("(./FORK_SPECIFIC_ENHANCEMENTS_RU.md)")) {
    issues.push("English fork document must link to the Russian document");
  }
  if (!russian.includes("(./README.md)")) {
    issues.push("Russian fork document must link to the English document");
  }

  const expectedNumbers = contract.sections.map((section) => section.number);
  for (const locale of ["en", "ru"]) {
    const actualNumbers = documents[locale].sections.map(
      (section) => section.number,
    );
    if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
      issues.push(
        `${locale} numbered fork sections must match ${expectedNumbers.join(", ")}`,
      );
    }
  }

  for (const sectionContract of contract.sections) {
    const englishSection = documents.en.sections.find(
      (section) => section.number === sectionContract.number,
    );
    const russianSection = documents.ru.sections.find(
      (section) => section.number === sectionContract.number,
    );
    if (!englishSection || !russianSection) continue;

    for (const [locale, section] of [
      ["en", englishSection],
      ["ru", russianSection],
    ]) {
      if (section.heading !== sectionContract.headings[locale]) {
        issues.push(
          `${locale} section ${sectionContract.number} heading must be ${sectionContract.headings[locale]}`,
        );
      }
      validateConcepts(
        issues,
        section.body,
        sectionContract.requiredConcepts,
        locale,
        `section ${sectionContract.number}`,
      );
      if (section.images.length !== 1) {
        issues.push(
          `${locale} section ${sectionContract.number} must contain exactly one image`,
        );
      }
    }

    if (englishSection.bulletCount !== russianSection.bulletCount) {
      issues.push(
        `section ${sectionContract.number} bullet count mismatch: en=${englishSection.bulletCount}, ru=${russianSection.bulletCount}`,
      );
    }
    if (
      englishSection.images.length === 1 &&
      russianSection.images.length === 1 &&
      path.basename(englishSection.images[0]) !==
        path.basename(russianSection.images[0])
    ) {
      issues.push(
        `section ${sectionContract.number} image basename mismatch: ${path.basename(englishSection.images[0])} != ${path.basename(russianSection.images[0])}`,
      );
    }
  }

  const conceptIds = [
    ...contract.guide.requiredConcepts,
    ...contract.sections.flatMap((section) => section.requiredConcepts),
  ].map((concept) => concept.id);
  if (new Set(conceptIds).size !== conceptIds.length) {
    issues.push("Fork documentation concept IDs must be unique");
  }

  return issues;
}

export function validateForkSourceContracts(sources) {
  const issues = [];
  const tagValues = [
    ...sources.tags.matchAll(/\bvalue:\s*'([^']+)'/gu),
  ].map((match) => match[1]);

  if (JSON.stringify(tagValues) !== JSON.stringify(EXPECTED_BUILT_IN_TAGS)) {
    issues.push(
      `built-in tag values must be ${EXPECTED_BUILT_IN_TAGS.join(", ")}`,
    );
  }
  if (
    !sources.search.includes("BUILT_IN_SEARCH_TAGS = builtInTagValues")
  ) {
    issues.push("search filters must use every built-in tag value");
  }
  if (
    !sources.ragContract.includes(
      "RAG_KNOWLEDGE_PROJECTION_VERSION = 2 as const",
    )
  ) {
    issues.push("RAG knowledge projection version must remain 2");
  }
  if (!sources.ragContract.includes('| "dictionary_term"')) {
    issues.push("RAG source contract must include dictionary_term");
  }
  if (!sources.ragSync.includes("sourceType: 'dictionary_term'")) {
    issues.push("RAG Sync must project dictionary_term sources");
  }
  if (
    !/tags\?:\s*\{\s*disabled\?:\s*string\[\]\s*\}/u.test(
      sources.archiveContract,
    )
  ) {
    issues.push("portable space settings must include disabled tags");
  }
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/iu.test(sources.knowledgeMigration)) {
    issues.push("the 130000 knowledge migration must not create indexes");
  }
  if (
    !sources.knowledgeMigration.includes(
      "ai_message_sources_source_type_check",
    ) || !sources.knowledgeMigration.includes("dictionary_term")
  ) {
    issues.push(
      "the 130000 knowledge migration must extend the AI source constraint",
    );
  }

  const dictionaryIndexes = [
    ["idx_dictionary_terms_term_trgm", "LOWER(f_unaccent(term))"],
    [
      "idx_dictionary_terms_definition_trgm",
      "LOWER(f_unaccent(definition_markdown))",
    ],
    [
      "idx_dictionary_term_aliases_normalized_trgm",
      "LOWER(f_unaccent(normalized_alias))",
    ],
  ];
  for (const [indexName, expression] of dictionaryIndexes) {
    if (
      !sources.searchMigration.includes(indexName) ||
      !sources.searchMigration.includes(expression)
    ) {
      issues.push(
        `the 140000 search migration must define ${indexName} with ${expression}`,
      );
    }
  }

  return issues;
}

async function validateImageTargets(contract, english, russian) {
  const issues = [];
  for (const [locale, source] of [
    ["en", english],
    ["ru", russian],
  ]) {
    const documentPath = contract.documents[locale];
    const documentDirectory = path.dirname(path.join(root, documentPath));
    const parsed = parseForkDocument(source, locale);
    for (const section of parsed.sections) {
      for (const image of section.images) {
        try {
          await access(path.resolve(documentDirectory, image));
        } catch {
          issues.push(`${locale} fork image does not exist: ${image}`);
        }
      }
    }
  }
  return issues;
}

async function main() {
  const contract = JSON.parse(
    await readFile(path.join(root, CONTRACT_PATH), "utf8"),
  );
  const english = normalizeLineEndings(
    await readFile(path.join(root, contract.documents.en), "utf8"),
  );
  const russian = normalizeLineEndings(
    await readFile(path.join(root, contract.documents.ru), "utf8"),
  );
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(SOURCE_PATHS).map(async ([name, sourcePath]) => [
        name,
        normalizeLineEndings(
          await readFile(path.join(root, sourcePath), "utf8"),
        ),
      ]),
    ),
  );
  const issues = [
    ...validateForkDocsContract({ contract, english, russian }),
    ...validateForkSourceContracts(sources),
    ...(await validateImageTargets(contract, english, russian)),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
  const conceptCount =
    contract.guide.requiredConcepts.length +
    contract.sections.reduce(
      (sum, section) => sum + section.requiredConcepts.length,
      0,
    );
  console.log(
    `Fork documentation contract is current: v${contract.version}, ${contract.sections.length} bilingual sections, ${contract.guide.anchors.length} administrator-guide anchors, ${conceptCount} semantic checks, and source-backed release contracts`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
