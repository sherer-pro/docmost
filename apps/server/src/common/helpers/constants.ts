import * as path from 'path';

export const APP_DATA_PATH = 'data';
export const LOCAL_STORAGE_DIR = `${APP_DATA_PATH}/storage`;

export function resolveAppRoot(cwd = process.cwd()): string {
  const resolvedCwd = path.resolve(cwd);
  const isServerPackageCwd =
    path.basename(resolvedCwd) === 'server' &&
    path.basename(path.dirname(resolvedCwd)) === 'apps';

  return isServerPackageCwd
    ? path.resolve(resolvedCwd, '..', '..')
    : resolvedCwd;
}

export function resolveLocalStoragePath(cwd = process.cwd()): string {
  return path.resolve(resolveAppRoot(cwd), LOCAL_STORAGE_DIR);
}

export const LOCAL_STORAGE_PATH = resolveLocalStoragePath();

export function getPageTitle(title: string | null | undefined): string {
  return title || 'untitled';
}
