import { createHash } from 'node:crypto';

/**
 * Serializes JSON-compatible data with stable object-key ordering.
 * Array order remains significant and undefined object properties are omitted,
 * matching JSON.stringify semantics for persisted JSON values.
 */
export function canonicalJsonString(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonString).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, item]) => `${JSON.stringify(key)}:${canonicalJsonString(item)}`,
    );
  return `{${entries.join(',')}}`;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonString(value), 'utf8')
    .digest('hex');
}
