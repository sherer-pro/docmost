#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

const FORBIDDEN_PATHS = [
  'apps/client/src/ee',
  'apps/server/src/ee',
  'packages/ee',
];

const FORBIDDEN_PATTERNS = [
  { name: '@docmost/ee alias', regex: /@docmost\/ee/ },
  { name: 'LicenseCheckService', regex: /LicenseCheckService/ },
  { name: 'hasLicenseKey', regex: /hasLicenseKey/ },
  { name: 'enterpriseModules', regex: /enterpriseModules/ },
  { name: 'dynamic EE require', regex: /require\([^)]*\/ee\// },
];

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
]);

const IGNORED_FILES = new Set([
  'scripts/check-no-ee.mjs',
  'graphify-out/.graphify_analysis.json',
  'graphify-out/.graphify_labels.json',
]);

function trackedFiles(...args) {
  const output = execFileSync('git', ['ls-files', '-z', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

const failures = [];

for (const forbiddenPath of FORBIDDEN_PATHS) {
  const files = trackedFiles('--', forbiddenPath);
  if (files.length > 0) {
    failures.push(
      `Tracked enterprise path "${forbiddenPath}" still contains ${files.length} file(s).`,
    );
  }
}

const gitmodulesPath = path.join(repoRoot, '.gitmodules');
if (existsSync(gitmodulesPath)) {
  const gitmodules = readFileSync(gitmodulesPath, 'utf8');
  if (/\/ee\b|\bee\]/.test(gitmodules)) {
    failures.push('.gitmodules still declares an enterprise submodule.');
  }
}

for (const file of trackedFiles()) {
  if (IGNORED_FILES.has(file)) continue;
  if (!SCANNED_EXTENSIONS.has(path.extname(file))) continue;

  let content;
  try {
    content = readFileSync(path.join(repoRoot, file), 'utf8');
  } catch {
    continue;
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(content)) {
      failures.push(`${file}: forbidden enterprise reference (${pattern.name}).`);
    }
  }
}

if (failures.length > 0) {
  console.error('Enterprise (EE) leftovers detected:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('No enterprise (EE) modules, aliases, or license hooks found.');
