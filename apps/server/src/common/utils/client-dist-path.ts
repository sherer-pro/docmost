import { join } from 'path';
import * as fs from 'node:fs';

/**
 * Returns the absolute path to the built frontend directory (`apps/client/dist`).
 *
 * Multiple candidates are required because:
 * - in dev mode, `__dirname` points to `apps/server/src/...`;
 * - in the Nest production build (`nest build`), code lives under `apps/server/dist/apps/server/src/...`;
 * - in Docker, the working directory is typically `/app`, with frontend assets at `/app/apps/client/dist`.
 *
 * The function checks the most likely locations and returns the first existing path.
 * If no directory is found, it returns `undefined`, and the caller decides
 * how to handle missing client assets.
 *
 * @param baseDir Directory used as the path resolution base (usually `__dirname`).
 */
export function resolveClientDistPath(baseDir: string): string | undefined {
  const candidatePaths = [
    // Nest production build: .../apps/server/dist/apps/server/src/** -> /app/apps/client/dist
    // Important: go up exactly 7 levels. Without the extra "..", the resolved path becomes
    // /app/apps/server/client/dist, and the frontend is incorrectly treated as missing.
    join(baseDir, '..', '..', '..', '..', '..', '..', '..', 'client', 'dist'),
    // Local run from sources: .../apps/server/src/** -> .../apps/client/dist
    join(baseDir, '..', '..', '..', '..', 'client', 'dist'),
    // Run from monorepo root (or container) with cwd=/app
    join(process.cwd(), 'apps', 'client', 'dist'),
  ];

  return candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
}
