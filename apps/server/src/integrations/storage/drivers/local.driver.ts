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
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';

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
