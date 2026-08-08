import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeLineEndings } from './text-normalization.mjs';

const root = process.cwd();
const paths = {
  inventory: 'apps/server/docs/api-route-inventory.generated.md',
  canonical: 'docs/AI_ASSISTANT_AND_RAG.md',
  operator: 'docs/AI_INTEGRATION.md',
  mcpController: 'apps/server/src/core/mcp/mcp.controller.ts',
  prefixExcludes: 'apps/server/src/common/config/api-prefix-excludes.ts',
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([name, filePath]) => [
    name,
    normalizeLineEndings(await readFile(path.join(root, filePath), 'utf8')),
  ]),
);
const files = Object.fromEntries(entries);

const inventoryRoutes = new Set(
  files.inventory
    .split(/\r?\n/)
    .map((line) => /^\| ([A-Z]+) \| `([^`]+)` \| `([^`]+)` \|$/.exec(line))
    .filter(Boolean)
    .map((match) => `${match[1]} ${match[2]}`),
);

function extractDocumentedApiRoutes(content) {
  const routes = new Set();
  for (const match of content.matchAll(/`([A-Z/]+) (\/api\/[^`?]+)(?:\?[^`]*)?`/g)) {
    const pathWithoutPrefix = match[2].slice('/api'.length);
    for (const method of match[1].split('/')) {
      routes.add(`${method} ${pathWithoutPrefix}`);
    }
  }
  return routes;
}

const canonicalRoutes = extractDocumentedApiRoutes(files.canonical);
const operatorRoutes = extractDocumentedApiRoutes(files.operator);
const criticalRoutes = [
  'GET /spaces/:spaceId/ai/config',
  'PATCH /spaces/:spaceId/ai/config',
  'POST /spaces/:spaceId/ai/config/actions/test-model',
  'POST /spaces/:spaceId/ai/config/actions/test-agent',
  'POST /spaces/:spaceId/ai/config/actions/test-retrieval',
  'GET /spaces/:spaceId/ai/status',
  'GET /spaces/:spaceId/ai/rag-sync',
  'PATCH /spaces/:spaceId/ai/rag-sync',
  'POST /spaces/:spaceId/ai/rag-sync/actions/test',
  'POST /spaces/:spaceId/ai/rag-sync/actions/enable',
  'POST /spaces/:spaceId/ai/rag-sync/actions/disable',
  'POST /spaces/:spaceId/ai/rag-sync/actions/retry-cleanup',
  'POST /spaces/:spaceId/ai/rag-sync/actions/force-disable',
  'POST /spaces/:spaceId/ai/rag-sync/actions/abandon-cleanup',
  'GET /ai/profile-policy',
  'PATCH /ai/profile-policy',
  'GET /ai/tool-policy',
  'PATCH /ai/tool-policy',
  'GET /ai/mcp-settings',
  'PATCH /ai/mcp-settings',
];
const operatorCriticalRoutes = [
  'GET /spaces/:spaceId/ai/config',
  'PATCH /spaces/:spaceId/ai/config',
  'POST /spaces/:spaceId/ai/config/actions/test-model',
  'POST /spaces/:spaceId/ai/config/actions/test-agent',
  'POST /spaces/:spaceId/ai/config/actions/test-retrieval',
  'GET /spaces/:spaceId/ai/status',
  'GET /spaces/:spaceId/ai/rag-sync',
  'PATCH /spaces/:spaceId/ai/rag-sync',
  'POST /spaces/:spaceId/ai/rag-sync/actions/test',
  'POST /spaces/:spaceId/ai/rag-sync/actions/enable',
  'POST /spaces/:spaceId/ai/rag-sync/actions/disable',
  'POST /spaces/:spaceId/ai/rag-sync/actions/retry-cleanup',
  'POST /spaces/:spaceId/ai/rag-sync/actions/force-disable',
  'POST /spaces/:spaceId/ai/rag-sync/actions/abandon-cleanup',
];
const migrationFiles = [
  '20260728T120000-ai-integration.ts',
  '20260729T120000-ai-reliability.ts',
  '20260729T180000-ai-context-editor-actions.ts',
  '20260729T220000-open-webui-rag.ts',
  '20260729T230000-ai-reasoning.ts',
  '20260730T120000-ai-content-policy.ts',
  '20260730T130000-ai-assistant-identity.ts',
  '20260730T140000-ai-agent-mcp.ts',
  '20260730T150000-remove-legacy-ee-imports-and-ai-search.ts',
  '20260803T120000-ai-external-mcp.ts',
  '20260804T120000-ai-citations.ts',
  '20260805T100000-ai-assistant-profiles.ts',
  '20260805T110000-ai-builtin-tool-policy.ts',
  '20260806T090000-rag-sync-bindings.ts',
];

const issues = [];
for (const route of criticalRoutes) {
  if (!inventoryRoutes.has(route)) {
    issues.push(`Critical AI route missing from inventory: ${route}`);
  }
  if (!canonicalRoutes.has(route)) {
    issues.push(`Critical AI route missing from canonical documentation: ${route}`);
  }
}
for (const route of operatorCriticalRoutes) {
  if (!operatorRoutes.has(route)) {
    issues.push(`Critical AI route missing from operator documentation: ${route}`);
  }
}

if (!/@Controller\(['"]mcp['"]\)/.test(files.mcpController)) {
  issues.push('Inbound MCP controller is not mounted at /mcp');
}
if (!/@All\(\)/.test(files.mcpController)) {
  issues.push('Inbound MCP controller does not expose the protocol handler');
}
if (!/['"]mcp['"]/.test(files.prefixExcludes)) {
  issues.push('Inbound /mcp is missing from global API-prefix exclusions');
}
if (!files.canonical.includes('root-level URL `/mcp`, not `/api/mcp`')) {
  issues.push('Canonical documentation does not preserve the root /mcp contract');
}

const ledger = /### AI and RAG migration ledger\n([\s\S]*?)\n## 5\./.exec(
  files.canonical,
)?.[1];
if (!ledger) {
  issues.push('Canonical documentation is missing the AI and RAG migration ledger');
} else {
  for (const fileName of migrationFiles) {
    const migrationPath = path.join(
      root,
      'apps/server/src/database/migrations',
      fileName,
    );
    try {
      await access(migrationPath);
    } catch {
      issues.push(`Migration listed by the contract does not exist: ${fileName}`);
    }
    if (ledger.split(fileName).length - 1 !== 2) {
      issues.push(`Migration ledger must link and name exactly once: ${fileName}`);
    }
  }
}

if (issues.length > 0) {
  throw new Error(issues.join('\n'));
}

console.log(
  `AI documentation contract is current: ${criticalRoutes.length} critical API routes, root /mcp, and ${migrationFiles.length} migrations`,
);
