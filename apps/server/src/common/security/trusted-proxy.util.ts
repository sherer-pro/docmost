import type { FastifyRequest } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import proxyaddr = require('@fastify/proxy-addr');

export type TrustedProxyConfig = false | true | string[];

const TRUST_ALL_VALUES = new Set(['true', '1', 'on', 'all', '*']);
const TRUST_NONE_VALUES = new Set(['', 'false', '0', 'off', 'none', 'no']);

export function parseTrustedProxies(value?: string | null): TrustedProxyConfig {
  const normalized = value?.trim().toLowerCase() ?? '';

  if (TRUST_NONE_VALUES.has(normalized)) {
    return false;
  }

  if (TRUST_ALL_VALUES.has(normalized)) {
    return true;
  }

  const proxies = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return proxies.length > 0 ? proxies : false;
}

function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if (
    (quote === '"' || quote === "'") &&
    trimmed.length >= 2 &&
    trimmed[trimmed.length - 1] === quote
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function readEnvFileValue(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`);
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      return stripEnvQuotes(match[1]);
    }
  }

  return undefined;
}

export function getTrustedProxiesFromEnv(
  envFilePath?: string,
): TrustedProxyConfig {
  return parseTrustedProxies(
    process.env.TRUSTED_PROXIES ??
      (envFilePath ? readEnvFileValue(envFilePath, 'TRUSTED_PROXIES') : ''),
  );
}

export function getClientIpFromFastifyRequest(
  request?: Pick<FastifyRequest, 'ip' | 'ips' | 'socket' | 'raw'>,
): string | null {
  return (
    request?.ip ||
    request?.ips?.[0] ||
    request?.socket?.remoteAddress ||
    request?.raw?.socket?.remoteAddress ||
    null
  );
}

export function getClientIpFromRawRequest(
  request: IncomingMessage & { remoteAddress?: string },
  trustedProxies: TrustedProxyConfig = getTrustedProxiesFromEnv(),
): string | null {
  const remoteAddress =
    request.socket?.remoteAddress || request.remoteAddress || null;

  if (!trustedProxies) {
    return remoteAddress;
  }

  try {
    if (trustedProxies === true) {
      return proxyaddr(request, () => true);
    }

    return proxyaddr(request, trustedProxies);
  } catch {
    return remoteAddress;
  }
}
