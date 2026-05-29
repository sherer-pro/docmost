import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const rootDir = process.cwd();

const targets = [
  join(rootDir, 'apps', 'client', 'node_modules', '.vite'),
  ...(await workspaceDistTargets('apps')),
  ...(await workspaceDistTargets('packages')),
];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}

async function workspaceDistTargets(workspaceDir) {
  const { readdir } = await import('node:fs/promises');
  const baseDir = join(rootDir, workspaceDir);
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(baseDir, entry.name, 'dist'));
}
