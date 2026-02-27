import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Returns the application version from the nearest package.json.
 *
 * The lookup supports both runtime layouts:
 * - source execution (`apps/server/src/...`);
 * - built dist output (`apps/server/dist/apps/server/src/...`).
 *
 * Returns `unknown` when package.json is missing or unreadable.
 */
export function getAppVersion(): string {
  const candidates = [
    join(process.cwd(), 'package.json'),
    join(__dirname, '..', '..', '..', 'package.json'),
    join(__dirname, '..', '..', '..', '..', '..', '..', 'package.json'),
  ];

  for (const packageJsonPath of candidates) {
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (typeof packageJson?.version === 'string') {
        return packageJson.version;
      }
    } catch {
      // Ignore malformed files and continue with the next candidate.
    }
  }

  return 'unknown';
}
