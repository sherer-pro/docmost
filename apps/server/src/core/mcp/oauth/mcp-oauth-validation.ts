import { HttpException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { validate as isUuid } from 'uuid';

export class McpOAuthError extends HttpException {
  constructor(
    error = 'invalid_request',
    description = 'Invalid OAuth request',
    status = 400,
  ) {
    super({ error, error_description: description }, status);
  }
}

export function oauthString(
  value: unknown,
  max = 2048,
  optional = false,
): string {
  if (optional && value === undefined) return '';
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    throw new McpOAuthError();
  return value;
}

export function oauthUuid(value: unknown): string {
  const id = oauthString(value, 36);
  if (!isUuid(id)) throw new McpOAuthError();
  return id;
}

export function oauthRedirect(value: unknown): string {
  const uri = oauthString(value);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new McpOAuthError();
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      ))
  )
    throw new McpOAuthError(
      'invalid_redirect_uri',
      'Use an exact HTTPS or loopback HTTP redirect URI',
    );
  return uri;
}

export function oauthHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function oauthSecret(prefix: 'dmoc' | 'dmoa' | 'dmor'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function oauthVerifier(value: unknown, challenge: string): boolean {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._~-]{43,128}$/.test(value) &&
    createHash('sha256').update(value).digest('base64url') === challenge
  );
}
