import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const AI_READ_RESULT_BYTES = 32 * 1024;
export const AI_READ_CURSOR_SCHEMA = {
  type: 'string',
  maxLength: 2048,
  description:
    'Opaque nextCursor from this tool and source. Continue until null; restart reading after MCP_SOURCE_CHANGED.',
};

export function hashReadVersion(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

type ReadCursor = {
  v: 2;
  tool: string;
  resource: string;
  version: string;
  offset: number;
};

export function readResultFits(
  value: unknown,
  maxBytes = AI_READ_RESULT_BYTES,
) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
}

export function encodeReadCursor(
  tool: string,
  resource: string,
  version: string,
  offset: number,
) {
  return Buffer.from(
    JSON.stringify({ v: 2, tool, resource, version, offset }),
  ).toString('base64url');
}

export function decodeReadCursor(
  cursor: string | undefined,
  tool: string,
  resource: string,
  version: string,
): number {
  if (!cursor) return 0;
  let value: ReadCursor;
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      value.v !== 2 ||
      value.tool !== tool ||
      value.resource !== resource ||
      typeof value.version !== 'string' ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0
    )
      throw new Error();
  } catch {
    throw new BadRequestException({
      code: 'MCP_INVALID_CURSOR',
      message: 'Invalid read cursor',
    });
  }
  if (value.version !== version) {
    throw new ConflictException({
      code: 'MCP_SOURCE_CHANGED',
      message: 'Source changed; restart reading',
    });
  }
  return value.offset;
}

function readResultTooLarge(): never {
  throw new BadRequestException({
    code: 'MCP_RESULT_TOO_LARGE',
    message: 'Read result exceeds its configured limit',
  });
}

function unicodeEnd(text: string, end: number) {
  if (
    end > 0 &&
    end < text.length &&
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  )
    return end - 1;
  return end;
}

export function paginateReadText(
  text: string,
  base: Record<string, unknown>,
  options: {
    tool: string;
    resource: string;
    version: string;
    cursor?: string;
    field?: string;
    maxBytes?: number;
    maxChars?: number;
  },
): Record<string, any> {
  const {
    tool,
    resource,
    version,
    cursor,
    field = 'text',
    maxBytes = AI_READ_RESULT_BYTES,
    maxChars = 16000,
  } = options;
  const offset = decodeReadCursor(cursor, tool, resource, version);
  if (offset > text.length || unicodeEnd(text, offset) !== offset) {
    throw new BadRequestException({
      code: 'MCP_INVALID_CURSOR',
      message: 'Invalid read offset',
    });
  }
  const make = (end: number) => ({
    ...base,
    [field]: text.slice(offset, end),
    offset,
    nextCursor:
      end < text.length ? encodeReadCursor(tool, resource, version, end) : null,
    truncated: end < text.length,
  });
  let low = offset;
  let high = Math.min(text.length, offset + maxChars);
  if (!readResultFits(make(offset), maxBytes)) readResultTooLarge();
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (readResultFits(make(unicodeEnd(text, middle)), maxBytes)) low = middle;
    else high = middle - 1;
  }
  const end = unicodeEnd(text, low);
  if (end === offset && offset < text.length) readResultTooLarge();
  return make(end);
}

export function paginateReadItems<T>(
  items: T[],
  base: Record<string, unknown>,
  options: {
    tool: string;
    resource: string;
    version: string;
    cursor?: string;
    limit?: number;
    maxBytes?: number;
    field?: string;
  },
): Record<string, any> {
  const {
    tool,
    resource,
    version,
    cursor,
    limit = 100,
    maxBytes = AI_READ_RESULT_BYTES,
    field = 'items',
  } = options;
  const offset = decodeReadCursor(cursor, tool, resource, version);
  if (offset > items.length)
    throw new BadRequestException({
      code: 'MCP_INVALID_CURSOR',
      message: 'Invalid read offset',
    });
  const make = (end: number) => ({
    ...base,
    [field]: items.slice(offset, end),
    nextCursor:
      end < items.length
        ? encodeReadCursor(tool, resource, version, end)
        : null,
    truncated: end < items.length,
  });
  let low = offset;
  let high = Math.min(items.length, offset + limit);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (readResultFits(make(middle), maxBytes)) low = middle;
    else high = middle - 1;
  }
  if (
    !readResultFits(make(low), maxBytes) ||
    (low === offset && offset < items.length)
  )
    readResultTooLarge();
  return make(low);
}
