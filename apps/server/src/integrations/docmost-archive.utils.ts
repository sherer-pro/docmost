import { DOCMOST_ARCHIVE_SCHEMA_VERSION } from '@docmost/api-contract';

export function getDocmostArchiveSchemaError(
  schemaVersion: unknown,
): string | null {
  if (schemaVersion === DOCMOST_ARCHIVE_SCHEMA_VERSION) return null;

  if (
    typeof schemaVersion === 'number' &&
    Number.isFinite(schemaVersion) &&
    schemaVersion > DOCMOST_ARCHIVE_SCHEMA_VERSION
  ) {
    return `Archive schema ${schemaVersion} is newer than supported schema ${DOCMOST_ARCHIVE_SCHEMA_VERSION}`;
  }

  const versionLabel =
    typeof schemaVersion === 'number' && Number.isFinite(schemaVersion)
      ? String(schemaVersion)
      : 'unknown';
  return `Docmost archive schema ${versionLabel} is not supported; only schema ${DOCMOST_ARCHIVE_SCHEMA_VERSION} is accepted`;
}

export function containsPageEmbedNode(value: unknown): boolean {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (
      !Array.isArray(current) &&
      (current as Record<string, unknown>).type === 'pageEmbed'
    ) {
      return true;
    }

    pending.push(...Object.values(current));
  }

  return false;
}
