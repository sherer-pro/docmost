import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditNoEe } from './check-no-ee.mjs';

const temporaryRepositories = [];

function createRepository(files) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'docmost-no-ee-'));
  temporaryRepositories.push(repoRoot);
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });

  for (const [file, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, file);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }

  execFileSync('git', ['add', '--all'], { cwd: repoRoot });
  return repoRoot;
}

test.after(() => {
  for (const repoRoot of temporaryRepositories) {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('accepts core modules and the exact historical migration allowlist', () => {
  const repoRoot = createRepository({
    'apps/server/src/core/sso/sso.module.ts':
      "import { Module } from '@nestjs/common';\nexport class SsoModule {}\n",
    'apps/server/src/database/migrations/20250106T195516-billing.ts':
      "export const table = 'billing';\n",
    'apps/server/src/database/migrations/20250222T114520-add_license_key_to_workspace.ts':
      "export const column = 'license_key';\n",
    'apps/server/src/database/migrations/20250623T215045-more-billing-columns.ts':
      "export const table = 'billing';\n",
    'apps/server/src/database/migrations/20260730T180000-remove-ee-license-column.ts':
      "export const removed = 'license_key';\n",
    'apps/server/src/database/migrations/20260730T190000-remove-ee-billing.ts':
      "export const removed = 'billing';\n",
    'package.json': '{"private":true}\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });

  assert.deepEqual(auditNoEe(repoRoot), []);
});

test('rejects tracked enterprise source paths', () => {
  const repoRoot = createRepository({
    'apps/server/src/ee/runtime.ts': 'export const enabled = true;\n',
  });

  assert.match(auditNoEe(repoRoot).join('\n'), /Tracked enterprise path/);
});

test('rejects an EE submodule declaration', () => {
  const repoRoot = createRepository({
    '.gitmodules':
      '[submodule "apps/server/src/ee"]\n\tpath = apps/server/src/ee\n\turl = https://github.com/docmost/ee\n',
  });

  assert.match(auditNoEe(repoRoot).join('\n'), /enterprise submodule/);
});

test('rejects enterprise package references in the lockfile', () => {
  const repoRoot = createRepository({
    'pnpm-lock.yaml': "packages:\n  '@docmost/ee@1.0.0': {}\n",
  });

  assert.match(auditNoEe(repoRoot).join('\n'), /@docmost\/ee alias/);
});

test('rejects static and dynamic enterprise module specifier variants', () => {
  const repoRoot = createRepository({
    'apps/server/src/core/static.ts': "import legacy from '../../ee/runtime';\n",
    'apps/client/src/dynamic.ts': "const legacy = import('@docmost/ee/sso');\n",
    'apps/client/src/alias-dynamic.ts':
      'const legacy = import(`@/ee/runtime`);\n',
    'apps/server/src/resolve.cjs':
      "const legacy = require.resolve('../../enterprise/runtime');\n",
  });

  const failures = auditNoEe(repoRoot).join('\n');
  assert.match(failures, /EE or enterprise module specifier/);
  assert.match(failures, /@docmost\/ee alias/);
});

test('rejects retired routes in generated inventories and documentation', () => {
  const repoRoot = createRepository({
    'apps/server/docs/api-route-inventory.generated.md':
      '| GET | `/api/billing/info` | legacy |\n',
  });

  assert.match(
    auditNoEe(repoRoot).join('\n'),
    /retired license or billing API or settings route/,
  );
});

test('rejects retired runtime symbols, routes, and config references', () => {
  const repoRoot = createRepository({
    'apps/server/src/runtime.ts':
      "const key = process.env.LICENSE_KEY;\nconst route = '/api/billing/info';\n",
    'config/runtime.json': '{"TRIAL_DAYS":14}\n',
  });

  const failures = auditNoEe(repoRoot).join('\n');
  assert.match(failures, /retired license, billing, or trial runtime symbol/);
  assert.match(
    failures,
    /retired license or billing API or settings route/,
  );
});

test('does not allow legacy schema names in a new migration', () => {
  const repoRoot = createRepository({
    'apps/server/src/database/migrations/20990101T000000-new-billing.ts':
      "export const table = 'billing';\n",
  });

  assert.match(
    auditNoEe(repoRoot).join('\n'),
    /retired billing or trial runtime reference/,
  );
});

test('rejects retired symbols in shell and environment configuration', () => {
  const repoRoot = createRepository({
    '.env.example': 'ENTERPRISE_LICENSE_KEY=replace-me\n',
    'scripts/start.sh': 'export BILLING_URL=https://billing.example.invalid\n',
  });

  const failures = auditNoEe(repoRoot).join('\n');
  assert.match(failures, /\.env\.example/);
  assert.match(failures, /scripts\/start\.sh/);
  assert.match(failures, /retired license, billing, or trial runtime symbol/);
});
