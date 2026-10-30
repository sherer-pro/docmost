import { hashCanonicalJson } from './canonical-json.util';

export function databaseSchemaFingerprint(
  properties: Array<{
    id: string;
    name: string;
    type: string;
    settings: unknown;
  }>,
): string {
  return hashCanonicalJson(
    properties
      .map(({ id, name, type, settings }) => ({ id, name, type, settings }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
