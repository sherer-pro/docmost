import * as yauzl from 'yauzl';
import * as path from 'path';
import * as fs from 'node:fs';

export enum FileTaskType {
  Import = 'import',
  Export = 'export',
}

export enum FileImportSource {
  Docmost = 'docmost',
  Generic = 'generic',
  Notion = 'notion',
}

export enum FileTaskStatus {
  Pending = 'pending',
  Processing = 'processing',
  Success = 'success',
  Failed = 'failed',
}

export interface ExtractZipOptions {
  maxEntries?: number;
  maxEntryUncompressedBytes?: number;
  maxTotalUncompressedBytes?: number;
  maxPathDepth?: number;
}

export interface ExtractZipLimits {
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxPathDepth: number;
}

interface ExtractZipState {
  entryCount: number;
  totalUncompressedBytes: number;
}

export const DEFAULT_EXTRACT_ZIP_LIMITS: ExtractZipLimits = {
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 250 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxPathDepth: 64,
};

/**
 * Entry names come from the archive, so they must never reach a log line
 * verbatim: newlines and control characters would let an attacker forge
 * additional log records.
 */
function sanitizeForLog(value: string): string {
  return JSON.stringify(String(value ?? '').slice(0, 256));
}

function logZipSecurityEvent(reason: string, entryName: string): void {
  console.warn(
    `[security][zip-entry-rejected] reason=${reason} entry=${sanitizeForLog(entryName)}`,
  );
}

function resolveExtractZipLimits(
  options?: ExtractZipOptions,
): ExtractZipLimits {
  return {
    ...DEFAULT_EXTRACT_ZIP_LIMITS,
    ...options,
  };
}

function ensureZipEntryWithinLimits(
  safeName: string,
  uncompressedSize: number,
  limits: ExtractZipLimits,
  state: ExtractZipState,
): void {
  state.entryCount += 1;

  if (state.entryCount > limits.maxEntries) {
    throw new Error(`ZIP entry count exceeds ${limits.maxEntries}`);
  }

  if (safeName.split('/').filter(Boolean).length > limits.maxPathDepth) {
    throw new Error(`ZIP path depth exceeds ${limits.maxPathDepth}`);
  }

  if (uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new Error(
      `ZIP entry size exceeds ${limits.maxEntryUncompressedBytes} bytes`,
    );
  }

  state.totalUncompressedBytes += uncompressedSize;
  if (state.totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
    throw new Error(
      `ZIP total uncompressed size exceeds ${limits.maxTotalUncompressedBytes} bytes`,
    );
  }
}

export class ZipBudgetExceededError extends Error {}

export interface ZipReadBudget {
  maxEntryBytes: number;
  maxTotalBytes: number;
  totalBytesRead: number;
}

interface ZipReadableEntry {
  name: string;
  nodeStream(type?: 'nodebuffer'): NodeJS.ReadableStream;
}

export function createZipReadBudget(
  options?: ExtractZipOptions,
): ZipReadBudget {
  const limits = resolveExtractZipLimits(options);

  return {
    maxEntryBytes: limits.maxEntryUncompressedBytes,
    maxTotalBytes: limits.maxTotalUncompressedBytes,
    totalBytesRead: 0,
  };
}

/**
 * Reads a single ZIP entry into memory under a hard decompressed byte budget.
 *
 * The uncompressed sizes recorded in a ZIP central directory are supplied by
 * whoever built the archive, so they can only ever serve as an early rejection
 * hint. This helper counts the bytes that actually leave the decompressor and
 * aborts the stream as soon as the per-entry or cumulative budget is exceeded,
 * which is what prevents a small archive from inflating until the process runs
 * out of memory.
 */
export function readZipEntryWithBudget(
  entry: ZipReadableEntry,
  budget: ZipReadBudget,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    const chunks: Buffer[] = [];
    let entryBytes = 0;
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      (stream as unknown as { destroy?: () => void }).destroy?.();
      finish();
    };

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      entryBytes += buffer.length;

      if (entryBytes > budget.maxEntryBytes) {
        logZipSecurityEvent('entry-budget-exceeded', entry.name);
        settle(() =>
          reject(
            new ZipBudgetExceededError(
              `ZIP entry exceeds the uncompressed size limit: ${entry.name}`,
            ),
          ),
        );
        return;
      }

      if (budget.totalBytesRead + entryBytes > budget.maxTotalBytes) {
        logZipSecurityEvent('total-budget-exceeded', entry.name);
        settle(() =>
          reject(
            new ZipBudgetExceededError(
              'ZIP total uncompressed size exceeds the limit',
            ),
          ),
        );
        return;
      }

      chunks.push(buffer);
    });

    stream.on('error', (err) => settle(() => reject(err)));

    stream.on('end', () =>
      settle(() => {
        budget.totalBytesRead += entryBytes;
        resolve(Buffer.concat(chunks));
      }),
    );
  });
}

export function getFileTaskFolderPath(
  type: FileTaskType,
  workspaceId: string,
): string {
  switch (type) {
    case FileTaskType.Import:
      return `${workspaceId}/imports`;
    case FileTaskType.Export:
      return `${workspaceId}/exports`;
  }
}

/**
 * Extracts a ZIP archive.
 */
export async function extractZip(
  source: string,
  target: string,
  options?: ExtractZipOptions,
): Promise<void> {
  return extractZipInternal(
    source,
    target,
    true,
    resolveExtractZipLimits(options),
    {
      entryCount: 0,
      totalUncompressedBytes: 0,
    },
  );
}

/**
 * Internal helper to extract a ZIP, with optional single-nested-ZIP handling.
 * @param source   Path to the ZIP file
 * @param target   Directory to extract into
 * @param allowNested  Whether to check and unwrap one level of nested ZIP
 */
function extractZipInternal(
  source: string,
  target: string,
  allowNested: boolean,
  limits: ExtractZipLimits,
  state: ExtractZipState,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      source,
      { lazyEntries: true, decodeStrings: false, autoClose: true },
      (err, zipfile) => {
        if (err) return reject(err);

        if (zipfile.entryCount > limits.maxEntries) {
          zipfile.close();
          return reject(
            new Error(`ZIP entry count exceeds ${limits.maxEntries}`),
          );
        }

        // Handle one level of nested ZIP if allowed
        if (allowNested && zipfile.entryCount === 1) {
          zipfile.readEntry();
          zipfile.once('entry', (entry) => {
            const name = entry.fileName.toString('utf8').replace(/^\/+/, '');
            const isZip =
              !/\/$/.test(entry.fileName) &&
              name.toLowerCase().endsWith('.zip');
            if (isZip) {
              // temporary name to avoid overwriting file
              const nestedPath = source.endsWith('.zip')
                ? source.slice(0, -4) + '.inner.zip'
                : source + '.inner.zip';

              zipfile.openReadStream(entry, (openErr, rs) => {
                if (openErr) return reject(openErr);
                try {
                  ensureZipEntryWithinLimits(
                    name,
                    entry.uncompressedSize,
                    limits,
                    state,
                  );
                } catch (limitErr) {
                  zipfile.close();
                  return reject(limitErr);
                }

                const ws = fs.createWriteStream(nestedPath);
                rs.on('error', reject);
                ws.on('error', reject);
                ws.on('finish', () => {
                  zipfile.close();
                  extractZipInternal(nestedPath, target, false, limits, state)
                    .then(() => {
                      fs.unlinkSync(nestedPath);
                      resolve();
                    })
                    .catch((extractErr) => {
                      fs.rmSync(nestedPath, { force: true });
                      reject(extractErr);
                    });
                });
                rs.pipe(ws);
              });
            } else {
              zipfile.close();
              extractZipInternal(source, target, false, limits, state).then(
                resolve,
                reject,
              );
            }
          });
          zipfile.once('error', reject);
          return;
        }

        // Normal extraction
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          const name = entry.fileName.toString('utf8');
          const safe = name.replace(/^\/+/, '');

          const validationError = yauzl.validateFileName(safe);
          if (validationError) {
            logZipSecurityEvent(
              `invalid-entry:${validationError}`,
              entry.fileName.toString('utf8'),
            );
            zipfile.readEntry();
            return;
          }

          if (safe.startsWith('__MACOSX/')) {
            zipfile.readEntry();
            return;
          }

          try {
            ensureZipEntryWithinLimits(
              safe,
              entry.uncompressedSize,
              limits,
              state,
            );
          } catch (limitErr) {
            logZipSecurityEvent('quota-exceeded', safe);
            zipfile.close();
            reject(limitErr);
            return;
          }

          const fullPath = path.join(target, safe);

          const resolved = path.resolve(fullPath);
          const targetResolved = path.resolve(target);

          if (!resolved.startsWith(targetResolved + path.sep)) {
            logZipSecurityEvent('outside-target', safe);
            zipfile.readEntry();
            return;
          }

          // Handle directories
          if (/\/$/.test(name)) {
            try {
              fs.mkdirSync(fullPath, { recursive: true });
            } catch (mkdirErr: any) {
              if (mkdirErr.code === 'ENAMETOOLONG') {
                logZipSecurityEvent('path-too-long-directory', safe);
                zipfile.readEntry();
                return;
              }
              return reject(mkdirErr);
            }
            zipfile.readEntry();
            return;
          }

          // Handle files
          try {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          } catch (mkdirErr: any) {
            if (mkdirErr.code === 'ENAMETOOLONG') {
              logZipSecurityEvent('path-too-long-file-dir', safe);
              zipfile.readEntry();
              return;
            }
            return reject(mkdirErr);
          }

          zipfile.openReadStream(entry, (openErr, rs) => {
            if (openErr) return reject(openErr);

            let ws: fs.WriteStream;
            try {
              ws = fs.createWriteStream(fullPath);
            } catch (openWsErr: any) {
              if (openWsErr.code === 'ENAMETOOLONG') {
                logZipSecurityEvent('path-too-long-file-write', safe);
                zipfile.readEntry();
                return;
              }
              return reject(openWsErr);
            }

            rs.on('error', (err) => reject(err));
            ws.on('error', (err) => {
              if ((err as any).code === 'ENAMETOOLONG') {
                logZipSecurityEvent('path-too-long-file-stream', safe);
                zipfile.readEntry();
              } else {
                reject(err);
              }
            });
            ws.on('finish', () => zipfile.readEntry());
            rs.pipe(ws);
          });
        });

        zipfile.on('end', () => resolve());
        zipfile.on('error', (err) => reject(err));
      },
    );
  });
}

export function cleanUrlString(url: string): string {
  if (!url) return null;
  const [mainUrl] = url.split('?', 1);
  return mainUrl;
}
