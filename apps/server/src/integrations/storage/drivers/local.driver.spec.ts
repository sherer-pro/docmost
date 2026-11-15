import * as fs from 'fs-extra';
import { join } from 'path';
import { dir, DirectoryResult } from 'tmp-promise';
import { LocalDriver } from './local.driver';
import { StorageObjectChangedError } from '../interfaces/storage-driver.interface';

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

  it('rejects an already aborted read-stream acquisition', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Stopped', 'AbortError'));

    await expect(
      driver.readStream('missing/file.txt', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('checks for abort again after local file acquisition', async () => {
    const controller = new AbortController();
    const readableCheck = jest
      .spyOn(driver as any, 'assertReadableFile')
      .mockImplementation(async () => {
        controller.abort(new DOMException('Stopped', 'AbortError'));
      });

    await expect(
      driver.readStream('file.txt', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(readableCheck).toHaveBeenCalled();
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
    await expect(
      driver.copy('source.txt', `../${escapedName}`),
    ).rejects.toThrow(/storage root/);

    await expect(
      fs.pathExists(join(tmpDir.path, '..', escapedName)),
    ).resolves.toBe(false);
  });

  it('reads bounded original bytes with a stable version and rejects overwrite', async () => {
    const source = Buffer.from(
      Array.from({ length: 50001 }, (_, i) => i % 251),
    );
    await driver.upload('original.bin', source);
    const chunks: Buffer[] = [];
    let offset = 0;
    let version: string | undefined;
    while (offset < source.length) {
      const part = await driver.readVersionedRange(
        'original.bin',
        offset,
        16384,
        version,
      );
      expect(part.data.length).toBeLessThanOrEqual(16384);
      expect(part.size).toBe(source.length);
      version ??= part.version;
      chunks.push(part.data);
      offset += part.data.length;
    }
    expect(Buffer.concat(chunks)).toEqual(source);
    await driver.upload('original.bin', Buffer.from('changed'));
    await expect(
      driver.readVersionedRange('original.bin', 0, 16384, version),
    ).rejects.toThrow(StorageObjectChangedError);
  });

  it('handles an empty file and rejects oversized or invalid ranges', async () => {
    await driver.upload('empty.bin', Buffer.alloc(0));
    expect(
      (await driver.readVersionedRange('empty.bin', 0, 16384)).data,
    ).toHaveLength(0);
    for (const [offset, length] of [
      [-1, 1],
      [0, 16385],
      [1, 1],
    ]) {
      await expect(
        driver.readVersionedRange('empty.bin', offset, length),
      ).rejects.toThrow(RangeError);
    }
  });
});
