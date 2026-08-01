export class ZipBudgetExceededError extends Error {}

export interface ZipReadBudget {
  maxEntryBytes: number;
  maxTotalBytes: number;
  totalBytesRead: number;
}

export interface ZipReadBudgetOptions {
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
}

interface ZipReadableEntry {
  name: string;
  nodeStream(type?: 'nodebuffer'): NodeJS.ReadableStream;
}

export interface PdfCanvasBudget {
  maxDimension: number;
  maxPixelsPerPage: number;
  maxCumulativePixels: number;
}

function safeEntryName(value: string): string {
  return JSON.stringify(String(value ?? '').slice(0, 256));
}

export function createZipReadBudget(
  options: ZipReadBudgetOptions,
): ZipReadBudget {
  return {
    maxEntryBytes: options.maxEntryUncompressedBytes,
    maxTotalBytes: options.maxTotalUncompressedBytes,
    totalBytesRead: 0,
  };
}

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
      if (settled) return;
      settled = true;
      (stream as unknown as { destroy?: () => void }).destroy?.();
      finish();
    };

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      entryBytes += buffer.length;
      if (entryBytes > budget.maxEntryBytes) {
        console.warn(
          `[security][zip-entry-rejected] reason=entry-budget-exceeded entry=${safeEntryName(entry.name)}`,
        );
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
        console.warn(
          `[security][zip-entry-rejected] reason=total-budget-exceeded entry=${safeEntryName(entry.name)}`,
        );
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
    stream.on('error', (error) => settle(() => reject(error)));
    stream.on('end', () =>
      settle(() => {
        budget.totalBytesRead += entryBytes;
        resolve(Buffer.concat(chunks));
      }),
    );
  });
}

export function assertPdfCanvasWithinBudget(
  width: number,
  height: number,
  cumulativePixels: number,
  budget: PdfCanvasBudget,
): number {
  const normalizedWidth = Math.ceil(width);
  const normalizedHeight = Math.ceil(height);
  if (
    !Number.isFinite(normalizedWidth) ||
    !Number.isFinite(normalizedHeight) ||
    normalizedWidth <= 0 ||
    normalizedHeight <= 0 ||
    normalizedWidth > budget.maxDimension ||
    normalizedHeight > budget.maxDimension
  ) {
    throw new Error('PDF page dimensions exceed the rendering limit');
  }
  const pixels = normalizedWidth * normalizedHeight;
  if (pixels > budget.maxPixelsPerPage) {
    throw new Error('PDF page pixel count exceeds the rendering limit');
  }
  const nextCumulativePixels = cumulativePixels + pixels;
  if (nextCumulativePixels > budget.maxCumulativePixels) {
    throw new Error('PDF cumulative pixel count exceeds the rendering limit');
  }
  return nextCumulativePixels;
}

export async function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  errorMessage: string,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(errorMessage);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
