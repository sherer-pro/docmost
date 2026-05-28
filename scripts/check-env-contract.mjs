import { existsSync, readFileSync } from 'node:fs';

const EXAMPLE_ENV_PATH = '.env.example';
const LOCAL_ENV_PATH = '.env';
const ENV_VALIDATION_PATH =
  'apps/server/src/integrations/environment/environment.validation.ts';
const VITE_CONFIG_PATH = 'apps/client/vite.config.ts';

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

const missingFromExample = sortedDiff(serverValidationKeys, exampleKeys);
const extraInExample = sortedDiff(exampleKeys, serverValidationKeys);
const viteMissingFromExample = sortedDiff(viteEnvKeys, exampleKeys);
const issues = [
  missingFromExample,
  extraInExample,
  viteMissingFromExample,
];

reportDiff('Server-validated keys missing from .env.example', missingFromExample);
reportDiff('Keys in .env.example missing from server validation', extraInExample);
reportDiff('Vite runtime keys missing from .env.example', viteMissingFromExample);

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
