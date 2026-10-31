import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { sanitize } from 'sanitize-filename-ts';
import { FastifyRequest } from 'fastify';
import { Readable, Transform } from 'stream';
import { isIP } from 'node:net';
import type { ConnectionOptions } from 'node:tls';

export const envPath = path.resolve(process.cwd(), '..', '..', '.env');

export async function hashPassword(password: string) {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function comparePasswordHash(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

export function generateRandomSuffixNumbers(length: number) {
  return Math.random()
    .toFixed(length)
    .substring(2, 2 + length);
}

export type RedisConfig = {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  family?: 4 | 6;
  tls?: ConnectionOptions;
};

export function parseRedisUrl(redisUrl: string): RedisConfig {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error('Invalid Redis URL');
  }
  if (
    !['redis:', 'rediss:'].includes(url.protocol) ||
    !url.hostname ||
    url.hash
  )
    throw new Error('Invalid Redis URL protocol, host or fragment');
  const host =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  const port = url.port ? Number(url.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid Redis port');
  const database =
    url.pathname === '' || url.pathname === '/' ? '0' : url.pathname.slice(1);
  if (!/^\d+$/.test(database) || !Number.isSafeInteger(Number(database)))
    throw new Error('Invalid Redis database index');
  const families = url.searchParams.getAll('family');
  if (
    families.length > 1 ||
    (families.length === 1 && !['4', '6'].includes(families[0]))
  )
    throw new Error('Invalid Redis address family');
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('Invalid Redis credential encoding');
  }
  return {
    host,
    port,
    db: Number(database),
    username: username || undefined,
    password: password || undefined,
    ...(families.length ? { family: Number(families[0]) as 4 | 6 } : {}),
    ...(url.protocol === 'rediss:'
      ? { tls: isIP(host) ? {} : { servername: host } }
      : {}),
  };
}

export function createRetryStrategy() {
  return function (times: number): number {
    return Math.max(Math.min(Math.exp(times), 20000), 3000);
  };
}

export function extractDateFromUuid7(uuid7: string) {
  //https://park.is/blog_posts/20240803_extracting_timestamp_from_uuid_v7/
  const parts = uuid7.split('-');
  const highBitsHex = parts[0] + parts[1].slice(0, 4);
  const timestamp = parseInt(highBitsHex, 16);

  return new Date(timestamp);
}

export function sanitizeFileName(fileName: string): string {
  const sanitizedFilename = sanitize(fileName)
    .replace(/ /g, '_')
    .replace(/#/g, '_');
  return sanitizedFilename.slice(0, 255);
}

export function removeAccent(str: string): string {
  if (!str) return str;
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function extractBearerTokenFromHeader(
  request: FastifyRequest,
): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

/**
 * Normalizes a database URL for postgres.js compatibility.
 * - Removes `sslmode=no-verify` (not supported by postgres.js), keeps other sslmode values
 * - Removes `schema` parameter (has no effect via connection string)
 * Note: If we don't strip them, the connection will fail
 */
export function normalizePostgresUrl(url: string): string {
  const parsed = new URL(url);
  const newParams = new URLSearchParams();

  for (const [key, value] of parsed.searchParams) {
    if (key === 'sslmode' && value === 'no-verify') continue;
    if (key === 'schema') continue;
    newParams.append(key, value);
  }

  parsed.search = newParams.toString();
  return parsed.toString();
}

export function createByteCountingStream(source: Readable) {
  let bytesRead = 0;
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      bytesRead += chunk.length;
      callback(null, chunk);
    },
  });

  source.pipe(stream);
  source.on('error', (err) => stream.emit('error', err));

  return { stream, getBytesRead: () => bytesRead };
}
