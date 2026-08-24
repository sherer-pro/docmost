import * as yauzl from 'yauzl';
import * as path from 'path';
import * as fs from 'node:fs';
import {
  createZipReadBudget as createBoundedZipReadBudget,
  readZipEntryWithBudget,
  ZipBudgetExceededError,
  type ZipReadBudget,
} from '../../../common/security/untrusted-document.util';
import { DOCMOST_ARCHIVE_ZIP_LIMITS } from '../../docmost-archive.utils';

export { readZipEntryWithBudget, ZipBudgetExceededError, type ZipReadBudget };

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
  Uploading = 'uploading',
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
  ...DOCMOST_ARCHIVE_ZIP_LIMITS,
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

function isZipSymbolicLink(entry: yauzl.Entry): boolean {
  const creatorPlatform = entry.versionMadeBy >>> 8;
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const unixFileType = unixMode & 0xf000;

  return creatorPlatform === 3 && unixFileType === 0xa000;
}

function validateZipEntryName(entryName: string): string {
  if (
    entryName.startsWith('/') ||
    entryName.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(entryName)
  ) {
    throw new Error('ZIP absolute path entries are not allowed');
  }

  const slashName = entryName.replace(/\\/g, '/');
  const normalized = path.posix.normalize(slashName);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Unsafe ZIP entry path');
  }

  const validationError = yauzl.validateFileName(entryName);
  if (validationError) {
    throw new Error(`Invalid ZIP entry path: ${validationError}`);
  }

  return normalized;
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

export function createZipReadBudget(
  options?: ExtractZipOptions,
): ZipReadBudget {
  const limits = resolveExtractZipLimits(options);
  return createBoundedZipReadBudget(limits);
}

/**
 * Validates central-directory metadata before a library such as JSZip can
 * collapse duplicate names or hide Unix file types from the caller.
 */
export function validateZipArchiveBuffer(
  source: Buffer,
  options?: ExtractZipOptions,
): Promise<void> {
  const limits = resolveExtractZipLimits(options);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      source,
      { lazyEntries: true, decodeStrings: false, autoClose: true },
      (error, zipfile) => {
        if (error) return reject(error);
        if (zipfile.entryCount > limits.maxEntries) {
          zipfile.close();
          return reject(
            new Error(`ZIP entry count exceeds ${limits.maxEntries}`),
          );
        }

        const state: ExtractZipState = {
          entryCount: 0,
          totalUncompressedBytes: 0,
        };
        let actualTotalUncompressedBytes = 0;
        const entryNames = new Set<string>();
        let settled = false;
        const fail = (reason: string, entryName: string, cause: Error) => {
          if (settled) return;
          settled = true;
          logZipSecurityEvent(reason, entryName);
          zipfile.close();
          reject(cause);
        };

        zipfile.on('entry', (entry) => {
          const rawName = entry.fileName.toString('utf8');
          let normalizedName: string;
          try {
            normalizedName = validateZipEntryName(rawName);
          } catch (entryError) {
            fail('invalid-entry-path', rawName, entryError as Error);
            return;
          }
          if (entryNames.has(normalizedName)) {
            fail(
              'duplicate-entry',
              rawName,
              new Error('ZIP archive contains a duplicate ZIP entry'),
            );
            return;
          }
          entryNames.add(normalizedName);
          if (isZipSymbolicLink(entry)) {
            fail(
              'symbolic-link',
              rawName,
              new Error('ZIP symbolic link entries are not allowed'),
            );
            return;
          }
          try {
            ensureZipEntryWithinLimits(
              normalizedName,
              entry.uncompressedSize,
              limits,
              state,
            );
          } catch (limitError) {
            fail('quota-exceeded', rawName, limitError as Error);
            return;
          }

          if (/\/$/.test(normalizedName)) {
            zipfile.readEntry();
            return;
          }

          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError) {
              fail('invalid-entry-data', rawName, streamError);
              return;
            }

            let actualEntryBytes = 0;
            stream.on('data', (chunk: Buffer) => {
              actualEntryBytes += chunk.length;
              actualTotalUncompressedBytes += chunk.length;
              if (
                actualEntryBytes > limits.maxEntryUncompressedBytes ||
                actualTotalUncompressedBytes > limits.maxTotalUncompressedBytes
              ) {
                stream.destroy(
                  new Error('ZIP uncompressed data exceeds the allowed limit'),
                );
              }
            });
            stream.once('error', (readError) => {
              fail('invalid-entry-data', rawName, readError);
            });
            stream.once('end', () => {
              if (!settled) zipfile.readEntry();
            });
            stream.resume();
          });
        });
        zipfile.once('end', () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });
        zipfile.once('error', (zipError) => {
          if (!settled) {
            settled = true;
            reject(zipError);
          }
        });
        zipfile.readEntry();
      },
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

        const entryNames = new Set<string>();

        // Handle one level of nested ZIP if allowed
        if (allowNested && zipfile.entryCount === 1) {
          zipfile.readEntry();
          zipfile.once('entry', (entry) => {
            const rawName = entry.fileName.toString('utf8');
            let name: string;
            try {
              name = validateZipEntryName(rawName);
            } catch (entryError) {
              logZipSecurityEvent('invalid-entry-path', rawName);
              zipfile.close();
              reject(entryError);
              return;
            }
            if (isZipSymbolicLink(entry)) {
              logZipSecurityEvent('symbolic-link', name);
              zipfile.close();
              reject(new Error('ZIP symbolic link entries are not allowed'));
              return;
            }
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
          let safe: string;
          try {
            safe = validateZipEntryName(name);
          } catch (entryError) {
            logZipSecurityEvent('invalid-entry-path', name);
            zipfile.close();
            reject(entryError);
            return;
          }

          if (entryNames.has(safe)) {
            logZipSecurityEvent('duplicate-entry', name);
            zipfile.close();
            reject(new Error('ZIP archive contains a duplicate ZIP entry'));
            return;
          }
          entryNames.add(safe);

          if (isZipSymbolicLink(entry)) {
            logZipSecurityEvent('symbolic-link', safe);
            zipfile.close();
            reject(new Error('ZIP symbolic link entries are not allowed'));
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
            zipfile.close();
            reject(new Error('ZIP entry resolves outside extraction target'));
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
