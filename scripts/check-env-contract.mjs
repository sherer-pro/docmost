import { existsSync, readFileSync } from 'node:fs';

const EXAMPLE_ENV_PATH = '.env.example';
const COMPOSE_ENV_PATH = '.env.compose.example';
const LOCAL_ENV_PATH = '.env';
const ENV_VALIDATION_PATH =
  'apps/server/src/integrations/environment/environment.validation.ts';
const VITE_CONFIG_PATH = 'apps/client/vite.config.ts';
const STATIC_MODULE_PATH = 'apps/server/src/integrations/static/static.module.ts';
const COMPOSE_PATH = 'docker-compose.yml';
const COMPOSE_ONLY_ENV_KEYS = new Set([
  'POSTGRES_DB',
  'POSTGRES_PASSWORD',
  'POSTGRES_USER',
  'RAG_SYNC_BINDING_ID',
  'RAG_SYNC_DOCMOST_API_KEY',
  'RAG_SYNC_DOCMOST_BASE_URL',
  'RAG_SYNC_KNOWLEDGE_ID',
  'RAG_SYNC_MAX_ATTACHMENT_BYTES',
  'RAG_SYNC_OPEN_WEBUI_API_KEY',
  'RAG_SYNC_OPEN_WEBUI_BASE_URL',
  'RAG_SYNC_POLL_INTERVAL_MS',
  'RAG_SYNC_PROCESSING_TIMEOUT_MS',
  'RAG_SYNC_REDIS_PREFIX',
  'RAG_SYNC_REDIS_URL',
  'RAG_SYNC_REQUEST_TIMEOUT_MS',
  'RAG_SYNC_SPACE_ID',
  'RAG_SYNC_WORKSPACE_ID',
]);
const SYNTHETIC_WINDOW_CONFIG_KEYS = new Set(['ENV']);
const REQUIRED_COMPOSE_RUNTIME_KEYS = new Set([
  'AI_ASSISTANT_PROFILES_ENABLED',
  'AI_BUILTIN_TOOL_EXTENSIONS_ENABLED',
  'PAGE_TEMPLATES_ENABLED',
]);
const REQUIRED_RAG_SYNC_RUNTIME_KEYS = new Set(
  [...COMPOSE_ONLY_ENV_KEYS].filter((key) => key.startsWith('RAG_SYNC_')),
);

function parseEnvKeys(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const keys = new Set();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=/);
    if (match) {
      keys.add(match[1]);
    }
  }

  return keys;
}

function extractServerValidationKeys() {
  const content = readFileSync(ENV_VALIDATION_PATH, 'utf8');
  return new Set(
    [...content.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map(
      (match) => match[1],
    ),
  );
}

function extractViteEnvKeys() {
  const content = readFileSync(VITE_CONFIG_PATH, 'utf8');
  const match = content.match(/const\s*{([\s\S]*?)}\s*=\s*loadEnv\(/);
  if (!match) {
    return new Set();
  }

  return new Set(
    match[1]
      .split(',')
      .map((rawKey) => rawKey.replace(/\/\/.*$/g, '').trim())
      .filter(Boolean)
      .map((rawKey) => rawKey.split(':')[0].trim()),
  );
}

function extractWindowConfigKeys() {
  const content = readFileSync(STATIC_MODULE_PATH, 'utf8');
  const match = content.match(/const\s+configString\s*=\s*{([\s\S]*?)\n\s*};/);
  if (!match) {
    return new Set();
  }

  return new Set(
    [...match[1].matchAll(/^\s*([A-Z][A-Z0-9_]+):/gm)]
      .map((match) => match[1])
      .filter((key) => !SYNTHETIC_WINDOW_CONFIG_KEYS.has(key)),
  );
}

function extractComposeServiceEnv(serviceName) {
  const entries = new Map();
  let inTargetService = false;
  let inEnvironment = false;

  for (const line of readFileSync(COMPOSE_PATH, 'utf8').split(/\r?\n/)) {
    if (line === `  ${serviceName}:`) {
      inTargetService = true;
      continue;
    }
    if (inTargetService && /^  \S/.test(line)) {
      break;
    }
    if (!inTargetService) {
      continue;
    }
    if (/^    environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (inEnvironment && /^    \S/.test(line)) {
      break;
    }
    if (!inEnvironment) {
      continue;
    }

    const match = /^      ([A-Z][A-Z0-9_]+):\s*(.+)$/.exec(line);
    if (match) {
      entries.set(match[1], match[2].trim());
    }
  }

  return entries;
}

function sortedDiff(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function reportDiff(title, values) {
  if (values.length === 0) {
    return;
  }

  console.error(`${title}:`);
  for (const value of values) {
    console.error(`  - ${value}`);
  }
}

if (!existsSync(EXAMPLE_ENV_PATH)) {
  console.error(`${EXAMPLE_ENV_PATH} is missing`);
  process.exit(1);
}

const exampleKeys = parseEnvKeys(EXAMPLE_ENV_PATH);
const serverValidationKeys = extractServerValidationKeys();
const viteEnvKeys = extractViteEnvKeys();
const windowConfigKeys = extractWindowConfigKeys();

const missingFromExample = sortedDiff(serverValidationKeys, exampleKeys);
const extraInExample = sortedDiff(
  exampleKeys,
  new Set([...serverValidationKeys, ...COMPOSE_ONLY_ENV_KEYS]),
);
const viteMissingFromExample = sortedDiff(viteEnvKeys, exampleKeys);
const windowConfigMissingFromExample = sortedDiff(windowConfigKeys, exampleKeys);
const issues = [
  missingFromExample,
  extraInExample,
  viteMissingFromExample,
  windowConfigMissingFromExample,
];

reportDiff('Server-validated keys missing from .env.example', missingFromExample);
reportDiff('Keys in .env.example missing from server validation', extraInExample);
reportDiff('Vite runtime keys missing from .env.example', viteMissingFromExample);
reportDiff(
  'Backend-served runtime keys missing from .env.example',
  windowConfigMissingFromExample,
);

if (existsSync(COMPOSE_ENV_PATH)) {
  const composeKeys = parseEnvKeys(COMPOSE_ENV_PATH);
  const composeMissing = sortedDiff(exampleKeys, composeKeys);
  const composeExtra = sortedDiff(composeKeys, exampleKeys);

  issues.push(composeMissing, composeExtra);
  reportDiff('Keys from .env.example missing from .env.compose.example', composeMissing);
  reportDiff('Keys in .env.compose.example missing from .env.example', composeExtra);
}

if (existsSync(COMPOSE_PATH)) {
  const composeServiceEnv = extractComposeServiceEnv('docmost');
  const composeRuntimeMissing = sortedDiff(
    REQUIRED_COMPOSE_RUNTIME_KEYS,
    new Set(composeServiceEnv.keys()),
  );
  const composeRuntimeNotForwarded = [...REQUIRED_COMPOSE_RUNTIME_KEYS]
    .filter((key) => {
      const value = composeServiceEnv.get(key) ?? '';
      return !value.includes(`\${${key}`);
    })
    .sort();

  issues.push(composeRuntimeMissing, composeRuntimeNotForwarded);
  reportDiff(
    'Required runtime keys missing from the docmost Compose service',
    composeRuntimeMissing,
  );
  reportDiff(
    'Required runtime keys not forwarded from the Compose environment',
    composeRuntimeNotForwarded,
  );

  const ragSyncServiceEnv = extractComposeServiceEnv('rag-sync');
  const ragSyncRuntimeMissing = sortedDiff(
    REQUIRED_RAG_SYNC_RUNTIME_KEYS,
    new Set(ragSyncServiceEnv.keys()),
  );
  const ragSyncRuntimeNotForwarded = [...REQUIRED_RAG_SYNC_RUNTIME_KEYS]
    .filter((key) => {
      const value = ragSyncServiceEnv.get(key) ?? '';
      return !value.includes(`\${${key}`);
    })
    .sort();

  issues.push(ragSyncRuntimeMissing, ragSyncRuntimeNotForwarded);
  reportDiff(
    'Required runtime keys missing from the rag-sync Compose service',
    ragSyncRuntimeMissing,
  );
  reportDiff(
    'Required rag-sync keys not forwarded from the Compose environment',
    ragSyncRuntimeNotForwarded,
  );
}

if (existsSync(LOCAL_ENV_PATH)) {
  const localKeys = parseEnvKeys(LOCAL_ENV_PATH);
  const localMissing = sortedDiff(exampleKeys, localKeys);
  const localExtra = sortedDiff(localKeys, exampleKeys);

  issues.push(localMissing, localExtra);
  reportDiff('Keys from .env.example missing from local .env', localMissing);
  reportDiff('Keys in local .env missing from .env.example', localExtra);
}

if (issues.some((values) => values.length > 0)) {
  process.exit(1);
}

console.log('Environment contract is in sync.');
