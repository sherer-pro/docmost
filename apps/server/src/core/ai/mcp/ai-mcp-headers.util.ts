import {
  decryptProtectedValue,
  encryptProtectedValue,
} from '../../../common/security/credential-protection.util';
import {
  AI_MCP_MAX_HEADER_VALUE_BYTES,
  AI_MCP_MAX_HEADERS,
  AI_MCP_MAX_HEADERS_TOTAL_BYTES,
} from './ai-mcp.constants';

/**
 * Header names an administrator may never set.
 *
 * The MCP session and protocol headers are on this list because the SDK merges
 * caller headers over its own (`_commonHeaders` in the Streamable HTTP client),
 * so an administrator-supplied `mcp-session-id` would win over the value the
 * transport is managing.
 */
const BLOCKED_HEADER_NAMES = new Set([
  // Hop-by-hop.
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Forwarding and client identity.
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'via',
  // Ambient credentials.
  'cookie',
  'set-cookie',
  // Owned by the transport.
  'host',
  'content-length',
  'content-type',
  'accept',
  'accept-encoding',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
]);

/** RFC 7230 token characters. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Printable ASCII plus horizontal tab, which excludes CR, LF, and NUL. */
const HEADER_VALUE_PATTERN = /^[\t\x20-\x7e]*$/;

/**
 * A string discriminant is deliberate: the repository compiles with
 * `strictNullChecks: false`, and TypeScript does not narrow unions on boolean
 * literal discriminants under that setting.
 */
export type AiMcpHeaderValidation =
  | { status: 'ok'; headers: Record<string, string>; names: string[] }
  | { status: 'rejected'; reason: string };

/**
 * Validates an administrator-supplied header map.
 *
 * Names are compared case-insensitively and normalized to lower case, so a
 * blocked header cannot be smuggled through by changing its casing.
 */
export function validateAiMcpHeaders(
  input: unknown,
): AiMcpHeaderValidation {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input)
  ) {
    return { status: 'rejected', reason: 'Headers must be an object' };
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > AI_MCP_MAX_HEADERS) {
    return {
      status: 'rejected',
      reason: `At most ${AI_MCP_MAX_HEADERS} headers are allowed`,
    };
  }

  const headers: Record<string, string> = {};
  let totalBytes = 0;

  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();

    if (!HEADER_NAME_PATTERN.test(name)) {
      return { status: 'rejected', reason: `Header name is invalid: ${rawName}` };
    }
    if (BLOCKED_HEADER_NAMES.has(name)) {
      return { status: 'rejected', reason: `Header is not allowed: ${name}` };
    }
    if (name in headers) {
      return { status: 'rejected', reason: `Header is duplicated: ${name}` };
    }
    if (typeof rawValue !== 'string') {
      return { status: 'rejected', reason: `Header value must be a string: ${name}` };
    }
    if (!HEADER_VALUE_PATTERN.test(rawValue)) {
      return { status: 'rejected', reason: `Header value is invalid: ${name}` };
    }

    const valueBytes = Buffer.byteLength(rawValue, 'utf8');
    if (valueBytes > AI_MCP_MAX_HEADER_VALUE_BYTES) {
      return { status: 'rejected', reason: `Header value is too large: ${name}` };
    }

    totalBytes += Buffer.byteLength(name, 'utf8') + valueBytes;
    if (totalBytes > AI_MCP_MAX_HEADERS_TOTAL_BYTES) {
      return { status: 'rejected', reason: 'Headers exceed the total size limit' };
    }

    headers[name] = rawValue;
  }

  return { status: 'ok', headers, names: Object.keys(headers).sort() };
}

/**
 * Encrypts the whole header map as one AES-256-GCM envelope.
 *
 * Returns `null` for an empty map so callers can store SQL NULL and treat
 * "no headers" and "cleared headers" identically.
 */
export function encryptAiMcpHeaders(
  headers: Record<string, string>,
  appSecret: string,
): string | null {
  if (Object.keys(headers).length === 0) {
    return null;
  }
  return encryptProtectedValue(JSON.stringify(headers), appSecret);
}

/**
 * Decrypts a stored header envelope.
 *
 * Throws on a tampered or undecryptable value rather than returning an empty
 * map. Connecting without the configured credentials would silently downgrade
 * an authenticated integration to an anonymous one.
 */
export function decryptAiMcpHeaders(
  ciphertext: string | null,
  appSecret: string,
): Record<string, string> {
  if (!ciphertext) {
    return {};
  }

  const parsed: unknown = JSON.parse(
    decryptProtectedValue(ciphertext, appSecret),
  );
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error('Stored external MCP headers are malformed');
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value !== 'string') {
      throw new Error('Stored external MCP headers are malformed');
    }
    headers[name] = value;
  }
  return headers;
}
