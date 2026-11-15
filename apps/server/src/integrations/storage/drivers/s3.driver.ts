import { S3StorageConfig, StorageDriver, StorageOption } from '../interfaces';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { streamToBuffer } from '../storage.utils';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getMimeType } from '../../../common/helpers';
import { Upload } from '@aws-sdk/lib-storage';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { StorageObjectChangedError } from '../interfaces/storage-driver.interface';

export class S3Driver implements StorageDriver {
  private readonly s3Client: S3Client;
  private readonly config: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    this.config = config;
    this.s3Client = new S3Client(config as any);
  }

  async upload(filePath: string, file: Buffer | Readable): Promise<void> {
    try {
      const contentType = getMimeType(filePath);

      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.config.bucket,
          Key: filePath,
          Body: file,
          ContentType: contentType,
        },
      });

      await upload.done();
    } catch (err) {
      Logger.error(err);
      throw new Error(`Failed to upload file: ${(err as Error).message}`);
    }
  }

  async uploadStream(
    filePath: string,
    file: Readable,
    options?: { recreateClient?: boolean },
  ): Promise<void> {
    let clientToUse = this.s3Client;
    let shouldDestroyClient = false;

    // optionally recreate client to avoid socket hang errors
    // (during multi-attachments imports)
    if (options?.recreateClient) {
      clientToUse = new S3Client(this.config as any);
      shouldDestroyClient = true;
    }

    try {
      const contentType = getMimeType(filePath);

      const upload = new Upload({
        client: clientToUse,
        params: {
          Bucket: this.config.bucket,
          Key: filePath,
          Body: file,
          ContentType: contentType,
        },
      });

      await upload.done();
    } catch (err) {
      Logger.error(err);
      throw new Error(`Failed to upload file: ${(err as Error).message}`);
    } finally {
      if (shouldDestroyClient && clientToUse) {
        clientToUse.destroy();
      }
    }
  }

  async copy(fromFilePath: string, toFilePath: string): Promise<void> {
    try {
      if (await this.exists(fromFilePath)) {
        await this.s3Client.send(
          new CopyObjectCommand({
            Bucket: this.config.bucket,
            CopySource: encodeS3CopySource(this.config.bucket, fromFilePath),
            Key: toFilePath,
          }),
        );
      }
    } catch (err) {
      throw new Error(`Failed to copy file: ${(err as Error).message}`);
    }
  }

  async read(filePath: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: filePath,
      });

      const response = await this.s3Client.send(command);

      return streamToBuffer(response.Body as Readable);
    } catch (err) {
      throw new Error(`Failed to read file from S3: ${(err as Error).message}`);
    }
  }

  async readStream(filePath: string, signal?: AbortSignal): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: filePath,
      });

      const response = await this.s3Client.send(command, {
        abortSignal: signal,
      });

      return response.Body as Readable;
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      throw new Error(`Failed to read file from S3: ${(err as Error).message}`);
    }
  }

  async readRangeStream(
    filePath: string,
    range: { start: number; end: number },
  ): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: filePath,
        Range: `bytes=${range.start}-${range.end}`,
      });

      const response = await this.s3Client.send(command);

      return response.Body as Readable;
    } catch (err) {
      throw new Error(`Failed to read file from S3: ${(err as Error).message}`);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: filePath,
      });

      await this.s3Client.send(command);
      return true;
    } catch (err) {
      if (isMissingS3ObjectError(err)) {
        return false;
      }
      throw err;
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
    const signal = AbortSignal.timeout(10000);
    const head = () =>
      this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: filePath }),
        { abortSignal: signal },
      );
    const fingerprint = (value: Awaited<ReturnType<typeof head>>) =>
      createHash('sha256')
        .update(
          JSON.stringify([
            value.ETag,
            value.VersionId,
            value.ContentLength,
            value.LastModified,
          ]),
        )
        .digest('hex');
    const before = await head();
    const size = before.ContentLength;
    if (!before.ETag || !Number.isSafeInteger(size) || offset > size!)
      throw new RangeError('Invalid storage object');
    const version = fingerprint(before);
    if (expectedVersion && expectedVersion !== version)
      throw new StorageObjectChangedError();
    let data = Buffer.alloc(0);
    if (offset < size!) {
      let response: GetObjectCommandOutput;
      try {
        response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.config.bucket,
            Key: filePath,
            Range: `bytes=${offset}-${Math.min(size! - 1, offset + maxBytes - 1)}`,
            IfMatch: before.ETag,
            VersionId: before.VersionId,
          }),
          { abortSignal: signal },
        );
      } catch (error) {
        if (
          (error as any)?.$metadata?.httpStatusCode === 412 ||
          isMissingS3ObjectError(error)
        )
          throw new StorageObjectChangedError();
        throw error;
      }
      const body = (response as any).Body as Readable;
      const abort = () => body.destroy(new Error('Storage read timed out'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const chunks: Buffer[] = [];
      let received = 0;
      try {
        for await (const chunk of body) {
          const bytes = Buffer.from(chunk);
          received += bytes.length;
          if (received > maxBytes)
            throw new Error('Storage range exceeds its limit');
          chunks.push(bytes);
        }
      } finally {
        signal.removeEventListener('abort', abort);
        body.destroy();
      }
      if (received !== Math.min(maxBytes, size! - offset))
        throw new StorageObjectChangedError();
      data = Buffer.concat(chunks);
    }
    let current: Awaited<ReturnType<typeof head>>;
    try {
      current = await head();
    } catch (error) {
      if (isMissingS3ObjectError(error)) throw new StorageObjectChangedError();
      throw error;
    }
    if (fingerprint(current) !== version) throw new StorageObjectChangedError();
    return { data, size: size!, version };
  }
  getUrl(filePath: string): string {
    return `${this.config.baseUrl ?? this.config.endpoint}/${this.config.bucket}/${filePath}`;
  }

  async getSignedUrl(filePath: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: filePath,
    });
    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async delete(filePath: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: filePath,
      });

      await this.s3Client.send(command);
    } catch (err) {
      throw new Error(
        `Error deleting file ${filePath} from S3. ${(err as Error).message}`,
      );
    }
  }

  getDriver(): S3Client {
    return this.s3Client;
  }

  getDriverName(): string {
    return StorageOption.S3;
  }

  getConfig(): Record<string, any> {
    return this.config;
  }
}

function isMissingS3ObjectError(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function encodeS3CopySource(bucket: string, key: string): string {
  return [bucket, ...key.split('/')].map(encodeS3CopySourceSegment).join('/');
}

function encodeS3CopySourceSegment(segment: string): string {
  // CopySource is decoded by S3 exactly once. Encode each path segment from
  // its raw value so a literal percent sequence cannot become a second path
  // separator, while retaining the separators between object-key segments.
  if (segment === '.') return '%2E';
  if (segment === '..') return '%2E%2E';
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
