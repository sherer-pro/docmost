import * as path from 'path';
import { resolveLocalStoragePath } from './constants';

describe('storage path constants', () => {
  it('resolves local storage under the runtime root when cwd is the root', () => {
    const root = path.resolve(path.sep, 'app');

    expect(resolveLocalStoragePath(root)).toBe(
      path.resolve(root, 'data', 'storage'),
    );
  });

  it('resolves local storage under the repository root when cwd is apps/server', () => {
    const root = path.resolve(path.sep, 'repo');
    const serverPackage = path.resolve(root, 'apps', 'server');

    expect(resolveLocalStoragePath(serverPackage)).toBe(
      path.resolve(root, 'data', 'storage'),
    );
  });
});
