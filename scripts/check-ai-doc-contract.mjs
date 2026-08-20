import { access, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLineEndings } from "./text-normalization.mjs";

const root = process.cwd();
const GUIDE_DOCUMENT = "docs/AI_ASSISTANT_AND_RAG.md";
const GUIDE_CONTENT =
  "apps/client/src/features/ai/components/ai-admin-guide-content.ts";
const GUIDE_CONTRACT =
  "apps/client/src/features/ai/components/ai-admin-guide-contract.json";
const GUIDE_COMPONENT =
  "apps/client/src/features/ai/components/ai-admin-guide.tsx";
const LOCALES_ROOT = "apps/client/public/locales";
const EXPECTED_ANCHORS = [
  "assistant",
  "retrieval",
  "rag-api",
  "rag-sync",
  "inbound-mcp",
  "outbound-mcp",
  "security",
  "troubleshooting",
];
const REQUIRED_GUIDE_CONTROLS = [
  "/mcp",
  "/api/rag/*",
  "AI_PROVIDER_ALLOWED_ORIGINS",
  "AI_RETRIEVAL_ALLOWED_ORIGINS",
  "RAG_SYNC_ENABLED",
  "RAG_SYNC_ALLOWED_ORIGINS",
  "AI_EXTERNAL_MCP_ENABLED",
  "AI_MCP_ALLOWED_ORIGINS",
];
export const AI_GUIDE_MIGRATION_FILES = [
  "20260728T120000-ai-integration.ts",
  "20260729T120000-ai-reliability.ts",
  "20260729T180000-ai-context-editor-actions.ts",
  "20260729T220000-open-webui-rag.ts",
  "20260729T230000-ai-reasoning.ts",
  "20260730T120000-ai-content-policy.ts",
  "20260730T130000-ai-assistant-identity.ts",
  "20260730T140000-ai-agent-mcp.ts",
  "20260730T150000-remove-legacy-ee-imports-and-ai-search.ts",
  "20260803T120000-ai-external-mcp.ts",
  "20260804T120000-ai-citations.ts",
  "20260805T100000-ai-assistant-profiles.ts",
  "20260805T110000-ai-builtin-tool-policy.ts",
  "20260806T090000-rag-sync-bindings.ts",
  "20260811T190000-rag-sync-target-verification.ts",
  "20260820T130000-knowledge-projection-dictionary-search.ts",
  "20260820T140000-search-dictionary-database-projection.ts",
];

const LOGIC_PATH_PATTERNS = [
  /^apps\/server\/src\/core\/(?:ai|rag|rag-sync|mcp|api-key)\//u,
  /^apps\/client\/src\/features\/(?:ai|ai-external-mcp|api-key)\//u,
  /^packages\/api-contract\/src\//u,
  /^apps\/server\/src\/database\/migrations\//u,
  /^apps\/server\/src\/environment\//u,
  /^scripts\/check-env-contract\.mjs$/u,
  /^\.env(?:\.compose)?\.example$/u,
  /^docker-compose\.yml$/u,
];
const NON_LOGIC_PATH_PATTERNS = [
  /(?:^|\/)(?:docs?|e2e|fixtures?|__tests__)(?:\/|$)/u,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/u,
  /\.snap$/u,
  /^apps\/server\/docs\//u,
];

function normalizeRepoPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isAiGuideLogicPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return (
    !NON_LOGIC_PATH_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    LOGIC_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export function evaluateAiGuideDiffContract({
  changedPaths,
  supportedLocales,
  baseVersion,
  currentVersion,
}) {
  const normalizedPaths = changedPaths.map(normalizeRepoPath);
  if (!normalizedPaths.some(isAiGuideLogicPath)) {
    return [];
  }

  const changed = new Set(normalizedPaths);
  const errors = [];
  for (const requiredPath of [GUIDE_DOCUMENT, GUIDE_CONTENT, GUIDE_CONTRACT]) {
    if (!changed.has(requiredPath)) {
      errors.push(
        `AI logic changed without updating required guide file: ${requiredPath}`,
      );
    }
  }
  for (const locale of supportedLocales) {
    const localePath = `${LOCALES_ROOT}/${locale}/translation.json`;
    if (!changed.has(localePath)) {
      errors.push(`AI logic changed without updating locale: ${locale}`);
    }
  }
  if (currentVersion !== baseVersion + 1) {
    errors.push(
      `AI guide contract version must increment by exactly one: ${baseVersion} -> ${currentVersion}`,
    );
  }
  return errors;
}

function flatten(value, prefix = "", result = {}) {
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      result[childPath] = child;
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, childPath, result);
    }
  }
  return result;
}

export function validateAiGuideRequiredFacts({
  guideContract,
  localeGuides,
}) {
  const issues = [];
  const factIds = new Set();
  for (const fact of guideContract.requiredFacts ?? []) {
    if (factIds.has(fact.id)) {
      issues.push(`AI guide required fact ID must be unique: ${fact.id}`);
    }
    factIds.add(fact.id);
    if (!guideContract.requiredKeys.includes(fact.key)) {
      issues.push(`AI guide required fact uses an unknown key: ${fact.key}`);
      continue;
    }
    for (const [locale, guide] of Object.entries(localeGuides)) {
      for (const needle of fact.needles) {
        if (!guide[fact.key]?.includes(needle)) {
          issues.push(
            `${locale} AI guide fact ${fact.id} is missing from ${fact.key}: ${needle}`,
          );
        }
      }
    }
  }
  return issues;
}

export function validateAiGuideUiContract({
  appRoutes,
  aiSettingsPage,
  settingsAccess,
  guideBrowserAcceptance,
  aiPlaywrightConfig,
}) {
  const issues = [];
  const administratorRoute =
    /<Route element=\{<WorkspaceAdminRoute \/>\}>[\s\S]*?<Route path=\{"ai\/:aiTab"\} element=\{<AiIntegrationsSettings \/>\}/u;
  if (!administratorRoute.test(appRoutes)) {
    issues.push(
      "AI guide route must remain inside the workspace-administrator route boundary",
    );
  }
  if (!settingsAccess.includes('"/settings/ai/guide"')) {
    issues.push("AI guide route must remain administrator-only");
  }
  if (
    !/<Tabs\.Tab[\s\S]*?value="guide"[\s\S]*?ai\.adminGuide\.tab[\s\S]*?<\/Tabs\.Tab>/u.test(
      aiSettingsPage,
    )
  ) {
    issues.push("AI guide must remain a separate AI settings tab");
  }
  if (
    !/<Tabs\.Panel value="guide"[\s\S]*?<AiAdminGuide \/>[\s\S]*?<\/Tabs\.Panel>/u.test(
      aiSettingsPage,
    )
  ) {
    issues.push("AI guide tab must render the administrator guide component");
  }
  if (!guideBrowserAcceptance.includes("/settings/ai/guide")) {
    issues.push("AI guide must keep production-like browser acceptance");
  }
  for (const anchor of EXPECTED_ANCHORS) {
    if (!guideBrowserAcceptance.includes(`"${anchor}"`)) {
      issues.push(`AI guide browser acceptance is missing anchor: ${anchor}`);
    }
  }
  if (!aiPlaywrightConfig.includes("admin-guide")) {
    issues.push("AI guide browser acceptance must run in the English project");
  }
  return issues;
}

function extractDocumentedApiRoutes(content) {
  const routes = new Set();
  for (const match of content.matchAll(
    /`([A-Z/]+) (\/api\/[^`?]+)(?:\?[^`]*)?`/gu,
  )) {
    const pathWithoutPrefix = match[2].slice("/api".length);
    for (const method of match[1].split("/")) {
      routes.add(`${method} ${pathWithoutPrefix}`);
    }
  }
  return routes;
}

function readGitVersion(revision) {
  try {
    const source = execFileSync(
      "git",
      ["show", `${revision}:${GUIDE_CONTRACT}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(source).version;
  } catch {
    return 0;
  }
}

function readChangedPaths(baseSha, headSha) {
  return execFileSync(
    "git",
    ["diff", "--name-only", `${baseSha}...${headSha}`],
    { cwd: root, encoding: "utf8" },
  )
    .split(/\r?\n/gu)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function validateStaticContract() {
  const paths = {
    inventory: "apps/server/docs/api-route-inventory.generated.md",
    canonical: GUIDE_DOCUMENT,
    operator: "docs/AI_INTEGRATION.md",
    mcpController: "apps/server/src/core/mcp/mcp.controller.ts",
    prefixExcludes: "apps/server/src/common/config/api-prefix-excludes.ts",
    guideContent: GUIDE_CONTENT,
    guideComponent: GUIDE_COMPONENT,
    guideContract: GUIDE_CONTRACT,
    appRoutes: "apps/client/src/App.tsx",
    aiSettingsPage:
      "apps/client/src/features/ai/pages/ai-integrations-settings.tsx",
    settingsAccess:
      "apps/client/src/components/settings/workspace-settings-access.ts",
    guideBrowserAcceptance: "apps/client/e2e/ai/specs/admin-guide.spec.ts",
    aiPlaywrightConfig: "apps/client/playwright.ai.config.ts",
  };
  const entries = await Promise.all(
    Object.entries(paths).map(async ([name, filePath]) => [
      name,
      normalizeLineEndings(await readFile(path.join(root, filePath), "utf8")),
    ]),
  );
  const files = Object.fromEntries(entries);
  const guideContract = JSON.parse(files.guideContract);
  const localeNames = (await readdir(path.join(root, LOCALES_ROOT))).sort();
  const localeGuides = Object.fromEntries(
    await Promise.all(
      localeNames.map(async (locale) => {
        const source = JSON.parse(
          await readFile(
            path.join(root, LOCALES_ROOT, locale, "translation.json"),
            "utf8",
          ),
        );
        return [locale, flatten(source.ai.adminGuide)];
      }),
    ),
  );
  const issues = [];

  if (
    JSON.stringify(guideContract.anchors) !== JSON.stringify(EXPECTED_ANCHORS)
  ) {
    issues.push("AI guide anchors do not match the stable hash contract");
  }
  if (!Number.isInteger(guideContract.version) || guideContract.version < 1) {
    issues.push("AI guide contract version must be a positive integer");
  }
  const versionMatch = /ai-admin-guide-contract-version:\s*(\d+)/u.exec(
    files.canonical,
  );
  if (!versionMatch) {
    issues.push("Canonical AI document is missing the guide contract version");
  } else if (Number(versionMatch[1]) !== guideContract.version) {
    issues.push(
      `AI guide contract version mismatch: UI ${guideContract.version}, docs ${versionMatch[1]}`,
    );
  }
  if (!files.guideContent.includes("guideContract.version")) {
    issues.push(
      "Structured AI guide content does not consume the manifest version",
    );
  }
  for (const anchor of EXPECTED_ANCHORS) {
    if (!files.guideContract.includes(`"${anchor}"`)) {
      issues.push(`AI guide manifest is missing anchor: ${anchor}`);
    }
  }
  for (const control of REQUIRED_GUIDE_CONTROLS) {
    if (!files.guideContent.includes(control)) {
      issues.push(`Structured AI guide content is missing control: ${control}`);
    }
  }
  for (const pathValue of [
    "/settings/ai/spaces",
    "/settings/keys/rag",
    "/settings/keys/mcp",
    "/settings/ai/external-tools",
  ]) {
    if (!files.guideContent.includes(pathValue)) {
      issues.push(
        `Structured AI guide content is missing CTA route: ${pathValue}`,
      );
    }
  }
  if (!files.guideComponent.includes("getAiAdminGuidePanelFromHash")) {
    issues.push("AI guide component does not activate stable hash navigation");
  }
  issues.push(
    ...validateAiGuideUiContract({
      appRoutes: files.appRoutes,
      aiSettingsPage: files.aiSettingsPage,
      settingsAccess: files.settingsAccess,
      guideBrowserAcceptance: files.guideBrowserAcceptance,
      aiPlaywrightConfig: files.aiPlaywrightConfig,
    }),
  );

  const requiredGuideKeys = [...guideContract.requiredKeys].sort();
  const englishGuide = localeGuides["en-US"];
  for (const [locale, guide] of Object.entries(localeGuides)) {
    const actualKeys = Object.keys(guide).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(requiredGuideKeys)) {
      issues.push(`${locale} AI guide keys do not match the explicit manifest`);
      continue;
    }
    for (const key of requiredGuideKeys) {
      if (!guide[key]?.trim()) {
        issues.push(`${locale} AI guide key is empty: ${key}`);
      }
      const expectedPlaceholders =
        englishGuide[key].match(/\{\{[^}]+\}\}/gu) ?? [];
      const actualPlaceholders = guide[key].match(/\{\{[^}]+\}\}/gu) ?? [];
      if (
        JSON.stringify(actualPlaceholders) !==
        JSON.stringify(expectedPlaceholders)
      ) {
        issues.push(`${locale} placeholder mismatch: ${key}`);
      }
    }
    for (const [key, value] of Object.entries(guide)) {
      if (value.includes("||")) {
        issues.push(`${locale} AI guide still uses a compact field: ${key}`);
      }
      if (
        key.startsWith("diagram.") &&
        (key.includes(".nodes.") || key.includes(".textAlternative.")) &&
        value.includes("|")
      ) {
        issues.push(
          `${locale} AI guide diagram still uses a compact field: ${key}`,
        );
      }
    }
  }
  issues.push(
    ...validateAiGuideRequiredFacts({ guideContract, localeGuides }),
  );

  const inventoryRoutes = new Set(
    files.inventory
      .split(/\r?\n/u)
      .map((line) => /^\| ([A-Z]+) \| `([^`]+)` \| `([^`]+)` \|$/u.exec(line))
      .filter(Boolean)
      .map((match) => `${match[1]} ${match[2]}`),
  );
  const canonicalRoutes = extractDocumentedApiRoutes(files.canonical);
  const operatorRoutes = extractDocumentedApiRoutes(files.operator);
  const criticalRoutes = [
    "GET /spaces/:spaceId/ai/config",
    "PATCH /spaces/:spaceId/ai/config",
    "POST /spaces/:spaceId/ai/config/actions/test-model",
    "POST /spaces/:spaceId/ai/config/actions/test-agent",
    "POST /spaces/:spaceId/ai/config/actions/test-retrieval",
    "GET /spaces/:spaceId/ai/status",
    "GET /spaces/:spaceId/ai/rag-sync",
    "PATCH /spaces/:spaceId/ai/rag-sync",
    "POST /spaces/:spaceId/ai/rag-sync/actions/test",
    "POST /spaces/:spaceId/ai/rag-sync/actions/enable",
    "POST /spaces/:spaceId/ai/rag-sync/actions/disable",
    "POST /spaces/:spaceId/ai/rag-sync/actions/retry-cleanup",
    "POST /spaces/:spaceId/ai/rag-sync/actions/force-disable",
    "POST /spaces/:spaceId/ai/rag-sync/actions/abandon-cleanup",
    "GET /ai/profile-policy",
    "PATCH /ai/profile-policy",
    "GET /ai/tool-policy",
    "PATCH /ai/tool-policy",
    "GET /ai/mcp-settings",
    "PATCH /ai/mcp-settings",
  ];
  const operatorCriticalRoutes = criticalRoutes.filter((route) =>
    route.includes("/spaces/:spaceId/ai/"),
  );
  for (const route of criticalRoutes) {
    if (!inventoryRoutes.has(route)) {
      issues.push(`Critical AI route missing from inventory: ${route}`);
    }
    if (!canonicalRoutes.has(route)) {
      issues.push(
        `Critical AI route missing from canonical documentation: ${route}`,
      );
    }
  }
  for (const route of operatorCriticalRoutes) {
    if (!operatorRoutes.has(route)) {
      issues.push(
        `Critical AI route missing from operator documentation: ${route}`,
      );
    }
  }
  if (!/@Controller\(['"]mcp['"]\)/u.test(files.mcpController)) {
    issues.push("Inbound MCP controller is not mounted at /mcp");
  }
  if (!/@All\(\)/u.test(files.mcpController)) {
    issues.push("Inbound MCP controller does not expose the protocol handler");
  }
  if (!/["']mcp["']/u.test(files.prefixExcludes)) {
    issues.push("Inbound /mcp is missing from global API-prefix exclusions");
  }
  if (!files.canonical.includes("root-level URL `/mcp`, not `/api/mcp`")) {
    issues.push(
      "Canonical documentation does not preserve the root /mcp contract",
    );
  }

  const migrationFiles = AI_GUIDE_MIGRATION_FILES;
  const ledger = /### AI and RAG migration ledger\n([\s\S]*?)\n## 5\./u.exec(
    files.canonical,
  )?.[1];
  if (!ledger) {
    issues.push(
      "Canonical documentation is missing the AI and RAG migration ledger",
    );
  } else {
    for (const fileName of migrationFiles) {
      try {
        await access(
          path.join(root, "apps/server/src/database/migrations", fileName),
        );
      } catch {
        issues.push(
          `Migration listed by the contract does not exist: ${fileName}`,
        );
      }
      if (ledger.split(fileName).length - 1 !== 2) {
        issues.push(
          `Migration ledger must link and name exactly once: ${fileName}`,
        );
      }
    }
  }

  return {
    issues,
    localeNames,
    guideContract,
    criticalRouteCount: criticalRoutes.length,
    migrationCount: migrationFiles.length,
  };
}

async function main() {
  const staticResult = await validateStaticContract();
  const issues = [...staticResult.issues];
  const baseSha = process.env.AI_GUIDE_BASE_SHA?.trim();
  const headSha = process.env.AI_GUIDE_HEAD_SHA?.trim();

  if (baseSha || headSha) {
    if (!baseSha || !headSha) {
      issues.push(
        "AI_GUIDE_BASE_SHA and AI_GUIDE_HEAD_SHA must be set together",
      );
    } else if (
      !/^[0-9a-f]{7,40}$/u.test(baseSha) ||
      !/^[0-9a-f]{7,40}$/u.test(headSha)
    ) {
      issues.push("AI guide diff SHAs must be hexadecimal Git revisions");
    } else {
      try {
        const changedPaths = readChangedPaths(baseSha, headSha);
        issues.push(
          ...evaluateAiGuideDiffContract({
            changedPaths,
            supportedLocales: staticResult.localeNames,
            baseVersion: readGitVersion(baseSha),
            currentVersion: staticResult.guideContract.version,
          }),
        );
      } catch (error) {
        issues.push(
          `AI guide diff contract could not read base/head revisions: ${error.message}`,
        );
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }

  console.log(
    `AI documentation contract is current: v${staticResult.guideContract.version}, ${staticResult.localeNames.length} locales, ${staticResult.criticalRouteCount} critical API routes, root /mcp, and ${staticResult.migrationCount} migrations`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
