import {
  StorageDriver,
  LocalStorageConfig,
  StorageOption,
} from '../interfaces';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import * as fs from 'fs-extra';
import { Readable } from 'stream';
import {
  constants as fsConstants,
  BigIntStats,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { StorageObjectChangedError } from '../interfaces/storage-driver.interface';

export class LocalDriver implements StorageDriver {
  private readonly config: LocalStorageConfig;
  private readonly storageRootPath: string;

  constructor(config: LocalStorageConfig) {
    this.config = config;
    this.storageRootPath = resolve(config.storagePath);
  }

  private _fullPath(filePath: string): string {
    if (!filePath) {
      throw new Error('Local storage file path is required');
    }

    if (isAbsolute(filePath)) {
      throw new Error('Local storage file path must be relative');
    }

    const resolvedPath = resolve(this.storageRootPath, filePath);
    const pathFromRoot = relative(this.storageRootPath, resolvedPath);

    if (
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error('Local storage file path escapes storage root');
    }

    return resolvedPath;
  }

  async upload(filePath: string, file: Buffer | Readable): Promise<void> {
    try {
      const fullPath = this._fullPath(filePath);
      if (file instanceof Buffer) {
        await fs.outputFile(fullPath, file);
      } else {
        await fs.mkdir(dirname(fullPath), { recursive: true });
        await pipeline(file, createWriteStream(fullPath));
      }
    } catch (err) {
      throw new Error(`Failed to upload file: ${(err as Error).message}`);
    }
  }

  async uploadStream(
    filePath: string,
    file: Readable,
    options?: { recreateClient?: boolean },
  ): Promise<void> {
    try {
      const fullPath = this._fullPath(filePath);
      await fs.mkdir(dirname(fullPath), { recursive: true });
      await pipeline(file, createWriteStream(fullPath));
    } catch (err) {
      throw new Error(`Failed to upload file: ${(err as Error).message}`);
    }
  }

  async copy(fromFilePath: string, toFilePath: string): Promise<void> {
    try {
      const fromFullPath = this._fullPath(fromFilePath);
      const toFullPath = this._fullPath(toFilePath);

      if (await this.exists(fromFilePath)) {
        await fs.copy(fromFullPath, toFullPath);
      }
    } catch (err) {
      throw new Error(`Failed to copy file: ${(err as Error).message}`);
    }
  }

  async read(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(this._fullPath(filePath));
    } catch (err) {
      throw new Error(`Failed to read file: ${(err as Error).message}`);
    }
  }

  async readStream(filePath: string, signal?: AbortSignal): Promise<Readable> {
    this.throwIfAborted(signal);
    try {
      const fullPath = this._fullPath(filePath);
      await this.assertReadableFile(fullPath);
      this.throwIfAborted(signal);

      return createReadStream(fullPath);
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      throw new Error(`Failed to read file: ${(err as Error).message}`);
    }
  }

  async readRangeStream(
    filePath: string,
    range: { start: number; end: number },
  ): Promise<Readable> {
    try {
      const fullPath = this._fullPath(filePath);
      await this.assertReadableFile(fullPath);

      return createReadStream(fullPath, {
        start: range.start,
        end: range.end,
      });
    } catch (err) {
      throw new Error(`Failed to read file: ${(err as Error).message}`);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      return await fs.pathExists(this._fullPath(filePath));
    } catch (err) {
      throw new Error(
        `Failed to check file existence: ${(err as Error).message}`,
      );
    }
  }

  async readVersionedRange(
    filePath: string,
    offset: number,
    maxBytes: number,
    expectedVersion?: string,
  ) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 16 * 1024
    )
      throw new RangeError('Invalid file range');
    const fullPath = this._fullPath(filePath);
    const handle = await open(fullPath, 'r');
    const fingerprint = (value: BigIntStats) =>
      createHash('sha256')
        .update(
          [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(
            ':',
          ),
        )
        .digest('hex');
    try {
      const before = await handle.stat({ bigint: true });
      const size = Number(before.size);
      if (!before.isFile() || !Number.isSafeInteger(size) || offset > size)
        throw new RangeError('Invalid file range');
      const version = fingerprint(before);
      if (expectedVersion && expectedVersion !== version)
        throw new StorageObjectChangedError();
      const data = Buffer.alloc(Math.min(maxBytes, size - offset));
      let read = 0;
      while (read < data.length) {
        const result = await handle.read(
          data,
          read,
          data.length - read,
          offset + read,
        );
        if (!result.bytesRead) break;
        read += result.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      const current = await stat(fullPath, { bigint: true }).catch(() => null);
      if (
        read !== data.length ||
        fingerprint(after) !== version ||
        !current ||
        fingerprint(current) !== version
      )
        throw new StorageObjectChangedError();
      return { data, size, version };
    } finally {
      await handle.close();
    }
  }

  async getSignedUrl(filePath: string, expireIn: number): Promise<string> {
    throw new Error('Signed URLs are not supported for local storage.');
  }

  getUrl(filePath: string): string {
    return this._fullPath(filePath);
  }

  async delete(filePath: string): Promise<void> {
    try {
      await fs.remove(this._fullPath(filePath));
    } catch (err) {
      throw new Error(`Failed to delete file: ${(err as Error).message}`);
    }
  }

  getDriver(): typeof fs {
    return fs;
  }

  getDriverName(): string {
    return StorageOption.LOCAL;
  }

  getConfig(): Record<string, any> {
    return this.config;
  }

  private async assertReadableFile(fullPath: string): Promise<void> {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      throw new Error('Local storage path is not a file');
    }

    await fs.access(fullPath, fsConstants.R_OK);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
  }
}
