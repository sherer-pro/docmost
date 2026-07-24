export function remapDatabaseViewConfig(
  value: unknown,
  propertyIdMap: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapDatabaseViewConfig(item, propertyIdMap));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const remapped: Record<string, unknown> = {};
  for (const [key, rawChildValue] of Object.entries(value)) {
    const childValue =
      (key === 'propertyId' || key === 'sortPropertyId') &&
      typeof rawChildValue === 'string'
        ? (propertyIdMap.get(rawChildValue) ?? rawChildValue)
        : remapDatabaseViewConfig(rawChildValue, propertyIdMap);

    remapped[propertyIdMap.get(key) ?? key] = childValue;
  }

  return remapped;
}

export function remapDatabasePageReference(
  value: unknown,
  propertyType: string | undefined,
  pageIdMap: Map<string, string>,
  missingValue: unknown = value,
): unknown {
  if (propertyType !== 'page_reference') {
    return value;
  }

  const sourceId = extractReferenceId(value, ['id', 'pageId']);
  if (!sourceId) {
    return value === null || typeof value === 'undefined'
      ? value
      : missingValue;
  }
  const mapped = pageIdMap.get(sourceId);
  if (!mapped) return missingValue;

  if (typeof value === 'string') return mapped;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (typeof source.id === 'string') return { ...source, id: mapped };
    if (typeof source.pageId === 'string') return { ...source, pageId: mapped };
    if ('value' in source) {
      return {
        ...source,
        value: remapDatabasePageReference(
          source.value,
          propertyType,
          pageIdMap,
          missingValue,
        ),
      };
    }
  }
  return mapped;
}

export function extractReferenceId(
  value: unknown,
  objectKeys: string[],
): string | null {
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) return null;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed !== candidate) return extractReferenceId(parsed, objectKeys);
    } catch {
      // The normal representation is a plain identifier.
    }
    return candidate;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  for (const key of objectKeys) {
    if (typeof source[key] === 'string' && source[key].trim()) {
      return source[key].trim();
    }
  }
  return 'value' in source
    ? extractReferenceId(source.value, objectKeys)
    : null;
}
