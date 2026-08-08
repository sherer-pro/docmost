import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { normalizeLineEndings } from './text-normalization.mjs';

const SERVER_SRC_DIR = 'apps/server/src';
const OUTPUT_PATH = 'apps/server/docs/api-route-inventory.generated.md';
const args = new Set(process.argv.slice(2));
const shouldCheck = args.has('--check');
const shouldPrint = args.has('--stdout');

function collectControllerFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectControllerFiles(fullPath));
      continue;
    }

    if (
      fullPath.endsWith('.controller.ts') &&
      !fullPath.endsWith('.spec.ts') &&
      !fullPath.endsWith('.quarantine.ts')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseDecoratorPaths(rawArg) {
  const value = rawArg?.trim() ?? '';
  if (!value) {
    return [''];
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const values = [...value.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
    return values.length > 0 ? values : [''];
  }

  const single = value.match(/^['"]([^'"]+)['"]$/);
  if (single) {
    return [single[1]];
  }

  return [''];
}

function normalizeSegment(segment) {
  return segment.replace(/^\/+/, '').replace(/\/+$/, '');
}

function joinRoute(basePath, methodPath) {
  const base = normalizeSegment(basePath);
  const method = normalizeSegment(methodPath);

  if (!base && !method) {
    return '/';
  }

  if (!base) {
    return `/${method}`;
  }

  if (!method) {
    return `/${base}`;
  }

  return `/${base}/${method}`;
}

function extractRoutes(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const controllerRegex = /@Controller\(([\s\S]*?)\)\s*export class\s+\w+/g;
  const controllerMatches = [...content.matchAll(controllerRegex)];
  if (controllerMatches.length === 0) {
    return [];
  }

  const routeDecoratorRegex = /@(Get|Post|Put|Patch|Delete|Options|Head)\(([\s\S]*?)\)/g;
  const routes = [];

  for (let index = 0; index < controllerMatches.length; index += 1) {
    const controllerMatch = controllerMatches[index];
    const nextControllerMatch = controllerMatches[index + 1];
    const controllerBodyStart = controllerMatch.index + controllerMatch[0].length;
    const controllerBodyEnd = nextControllerMatch?.index ?? content.length;
    const controllerBody = content.slice(controllerBodyStart, controllerBodyEnd);
    const basePaths = parseDecoratorPaths(controllerMatch[1]);
    let match;

    routeDecoratorRegex.lastIndex = 0;
    while ((match = routeDecoratorRegex.exec(controllerBody)) !== null) {
      const method = match[1].toUpperCase();
      const decoratorPaths = parseDecoratorPaths(match[2]);

      for (const basePath of basePaths) {
        for (const methodPath of decoratorPaths) {
          routes.push({
            method,
            path: joinRoute(basePath, methodPath),
            file: relative('.', filePath).replace(/\\/g, '/'),
          });
        }
      }
    }
  }

  return routes;
}

const controllerFiles = collectControllerFiles(SERVER_SRC_DIR);
const routes = controllerFiles
  .flatMap((filePath) => extractRoutes(filePath))
  .sort((a, b) => {
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    if (a.method !== b.method) {
      return a.method.localeCompare(b.method);
    }
    return a.file.localeCompare(b.file);
  });

const lines = [
  '# API Route Inventory (Generated)',
  '',
  '> Source: backend controllers under `apps/server/src/**/*.controller.ts`.',
  '',
  '| Method | Path | Source |',
  '| --- | --- | --- |',
  ...routes.map((route) => `| ${route.method} | \`${route.path}\` | \`${route.file}\` |`),
  '',
];
const output = `${lines.join('\n')}`;

if (shouldCheck) {
  if (!existsSync(OUTPUT_PATH)) {
    console.error(`Missing generated route inventory: ${OUTPUT_PATH}`);
    process.exit(1);
  }

  const current = normalizeLineEndings(readFileSync(OUTPUT_PATH, 'utf8'));
  if (current !== output) {
    console.error(
      `Route inventory is out of date. Run: node scripts/generate-api-route-inventory.mjs`,
    );
    process.exit(1);
  }

  console.log(`Route inventory is up to date (${routes.length} routes).`);
  process.exit(0);
}

if (shouldPrint) {
  process.stdout.write(output);
  process.exit(0);
}

writeFileSync(OUTPUT_PATH, output);

console.log(`Generated ${routes.length} routes -> ${OUTPUT_PATH}`);
