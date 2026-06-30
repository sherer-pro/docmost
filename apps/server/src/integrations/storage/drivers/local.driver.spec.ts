import * as fs from 'fs-extra';
import { join } from 'path';
import { dir, DirectoryResult } from 'tmp-promise';
import { LocalDriver } from './local.driver';

describe('LocalDriver', () => {
  let tmpDir: DirectoryResult;
  let driver: LocalDriver;

  beforeEach(async () => {
    tmpDir = await dir({ unsafeCleanup: true });
    driver = new LocalDriver({ storagePath: tmpDir.path });
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  it('stores and reads files inside the configured storage root', async () => {
    await driver.upload('workspace/files/file.txt', Buffer.from('content'));

    await expect(driver.read('workspace/files/file.txt')).resolves.toEqual(
      Buffer.from('content'),
    );
    await expect(
      fs.pathExists(join(tmpDir.path, 'workspace', 'files', 'file.txt')),
    ).resolves.toBe(true);
  });

  it('rejects missing read streams before creating a stream', async () => {
    await expect(driver.readStream('missing/file.txt')).rejects.toThrow(
      /Failed to read file/,
    );
  });

  it('rejects missing range read streams before creating a stream', async () => {
    await expect(
      driver.readRangeStream('missing/file.txt', { start: 0, end: 1 }),
    ).rejects.toThrow(/Failed to read file/);
  });

  it('rejects traversal paths that escape the storage root', async () => {
    const escapedName = `escaped-${Date.now()}.txt`;

    await expect(
      driver.upload(`../${escapedName}`, Buffer.from('blocked')),
    ).rejects.toThrow(/storage root/);

    await expect(
      fs.pathExists(join(tmpDir.path, '..', escapedName)),
    ).resolves.toBe(false);
  });

  it('rejects absolute paths even when they point under the storage root', async () => {
    const absolutePath = join(tmpDir.path, 'absolute.txt');

    await expect(
      driver.upload(absolutePath, Buffer.from('blocked')),
    ).rejects.toThrow(/must be relative/);
    await expect(fs.pathExists(absolutePath)).resolves.toBe(false);
  });

  it('rejects copy destinations that escape the storage root', async () => {
    const escapedName = `copied-${Date.now()}.txt`;

    await driver.upload('source.txt', Buffer.from('source'));
    await expect(driver.copy('source.txt', `../${escapedName}`)).rejects.toThrow(
      /storage root/,
    );

    await expect(
      fs.pathExists(join(tmpDir.path, '..', escapedName)),
    ).resolves.toBe(false);
  });
});
