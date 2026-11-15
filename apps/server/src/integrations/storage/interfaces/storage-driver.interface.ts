import { Readable } from 'stream';

export class StorageObjectChangedError extends Error {
  constructor() {
    super('Storage object changed');
  }
}

export interface VersionedStorageRange {
  data: Buffer;
  size: number;
  version: string;
}

export interface StorageDriver {
  upload(filePath: string, file: Buffer | Readable): Promise<void>;

  uploadStream(
    filePath: string,
    file: Readable,
    options?: { recreateClient?: boolean },
  ): Promise<void>;

  copy(fromFilePath: string, toFilePath: string): Promise<void>;

  read(filePath: string): Promise<Buffer>;

  readStream(filePath: string, signal?: AbortSignal): Promise<Readable>;

  readRangeStream(
    filePath: string,
    range: { start: number; end: number },
  ): Promise<Readable>;

  readVersionedRange(
    filePath: string,
    offset: number,
    maxBytes: number,
    expectedVersion?: string,
  ): Promise<VersionedStorageRange>;

  exists(filePath: string): Promise<boolean>;

  getUrl(filePath: string): string;

  getSignedUrl(filePath: string, expireIn: number): Promise<string>;

  delete(filePath: string): Promise<void>;

  getDriver(): any;

  getDriverName(): string;

  getConfig(): Record<string, any>;
}
