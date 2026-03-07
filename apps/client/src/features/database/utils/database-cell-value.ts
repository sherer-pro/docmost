import { IDatabaseProperty, IDatabaseSelectOption, IDatabaseSelectPropertySettings } from '@/features/database/types/database.types';

interface LegacyCellValueContainer {
  value: unknown;
  rawValueBeforeTypeChange: unknown;
  rawTypeBeforeTypeChange?: string | null;
}

interface DatabaseCellDisplayValueParams {
  property?: IDatabaseProperty;
  value: unknown;
  pageTitleById?: Record<string, string>;
}

const SERIALIZED_STRING_NORMALIZE_DEPTH = 6;
const LEGACY_RU_TRUE_TOKEN = '\u0434\u0430';
const LEGACY_RU_FALSE_TOKEN = '\u043d\u0435\u0442';
const BOOLEAN_TRUE_TOKENS = new Set(['true', '1', 'yes', 'on', LEGACY_RU_TRUE_TOKEN]);
const BOOLEAN_FALSE_TOKENS = new Set(['false', '0', 'no', 'off', LEGACY_RU_FALSE_TOKEN, '']);

/**
 * Unwraps malformed values that were JSON-stringified one or more times.
 *
 * Example: "\"\\\"hello\\nworld\\\"\"" -> "hello\nworld"
 */
function normalizeSerializedDatabaseString(value: string): string {
  let normalizedValue = value;

  for (
    let normalizeIteration = 0;
    normalizeIteration < SERIALIZED_STRING_NORMALIZE_DEPTH;
    normalizeIteration += 1
  ) {
    const trimmedValue = normalizedValue.trim();
    if (!trimmedValue.startsWith('"') || !trimmedValue.endsWith('"')) {
      break;
    }

    try {
      const parsedValue = JSON.parse(normalizedValue);
      if (typeof parsedValue !== 'string') {
        break;
      }

      normalizedValue = parsedValue;
    } catch {
      break;
    }
  }

  return normalizedValue;
}

function normalizeDatabaseBooleanToken(value: string): boolean | null {
  const normalizedToken = normalizeSerializedDatabaseString(value).trim().toLowerCase();

  if (BOOLEAN_TRUE_TOKENS.has(normalizedToken)) {
    return true;
  }

  if (BOOLEAN_FALSE_TOKENS.has(normalizedToken)) {
    return false;
  }

  return null;
}

function extractDatabaseUserId(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalizedValue = normalizeSerializedDatabaseString(value).trim();

    if (!normalizedValue) {
      return null;
    }

    try {
      const parsedValue = JSON.parse(normalizedValue);
      const parsedUserId = extractDatabaseUserId(parsedValue);

      if (parsedUserId) {
        return parsedUserId;
      }
    } catch {
      // Keep the normalized string below.
    }

    return normalizedValue;
  }

  if (value && typeof value === 'object' && 'id' in value) {
    const candidateId = (value as { id?: unknown }).id;
    return typeof candidateId === 'string'
      ? normalizeSerializedDatabaseString(candidateId).trim() || null
      : null;
  }

  return null;
}


/**
 * Returns current cell value from fallback container
 * used after property type conversion.
 */
export function extractCurrentDatabaseCellValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const candidate = value as Partial<LegacyCellValueContainer>;
  if (!('value' in candidate) || !('rawValueBeforeTypeChange' in candidate)) {
    return value;
  }

  return candidate.value;
}

/**
 * Normalizes string cell values, including legacy escape cleanup.
 */
export function normalizeDatabaseStringValue(value: unknown): string {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (typeof currentValue !== 'string') {
    return '';
  }

  return normalizeSerializedDatabaseString(currentValue);
}

/**
 * Normalizes user value to `id`.
 * Supported shapes: `string | { id: string } | null`.
 */
export function normalizeDatabaseUserId(value: unknown): string | null {
  return extractDatabaseUserId(extractCurrentDatabaseCellValue(value));
}

/**
 * Normalizes checkbox values to a strict boolean.
 * Supports legacy string payloads (`"true"`, `"false"`) and serialized forms.
 */
export function normalizeDatabaseCheckboxValue(value: unknown): boolean {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (typeof currentValue === 'boolean') {
    return currentValue;
  }

  if (typeof currentValue === 'string') {
    const normalizedToken = normalizeDatabaseBooleanToken(currentValue);

    if (normalizedToken !== null) {
      return normalizedToken;
    }

    return Boolean(normalizeSerializedDatabaseString(currentValue).trim());
  }

  if (currentValue === null || typeof currentValue === 'undefined') {
    return false;
  }

  return Boolean(currentValue);
}


/**
 * Normalizes select value to string `value`.
 * Supports both direct string and fallback object after type changes.
 */
export function normalizeDatabaseSelectValue(value: unknown): string {
  return normalizeDatabaseStringValue(value);
}

/**
 * Normalizes page_reference value to string `pageId`.
 * Supports both direct string and fallback object after type changes.
 */
export function normalizeDatabasePageReferenceValue(value: unknown): string {
  return normalizeDatabaseStringValue(value);
}

/**
 * Returns select property settings in a safe typed format.
 */
export function getDatabaseSelectSettings(property?: IDatabaseProperty): IDatabaseSelectPropertySettings {
  if (!property?.settings || typeof property.settings !== 'object') {
    return { options: [] };
  }

  const maybeOptions = (property.settings as { options?: unknown }).options;

  if (!Array.isArray(maybeOptions)) {
    return { options: [] };
  }

  const options: IDatabaseSelectOption[] = maybeOptions
    .filter((option): option is IDatabaseSelectOption => {
      if (!option || typeof option !== 'object') {
        return false;
      }

      const candidate = option as IDatabaseSelectOption;
      return typeof candidate.label === 'string' && typeof candidate.value === 'string';
    })
    .map((option) => ({
      label: option.label,
      value: option.value,
      color: option.color,
    }));

  return { options };
}

/**
 * Finds select option by normalized current value.
 */
export function getDatabaseSelectOption(
  property: IDatabaseProperty,
  value: unknown,
): IDatabaseSelectOption | null {
  const normalizedValue = normalizeDatabaseSelectValue(value);

  if (!normalizedValue) {
    return null;
  }

  const settings = getDatabaseSelectSettings(property);
  return settings.options.find((option) => option.value === normalizedValue) || null;
}

/**
 * Returns display string value for filtering/sorting/export
 * so UI and markdown paths use the same display model.
 */
export function getDatabaseCellDisplayValue({
  property,
  value,
  pageTitleById,
}: DatabaseCellDisplayValueParams): string {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (!property) {
    if (typeof currentValue === 'string') {
      return normalizeSerializedDatabaseString(currentValue);
    }

    if (currentValue === null || typeof currentValue === 'undefined') {
      return '';
    }

    return JSON.stringify(currentValue);
  }

  if (property.type === 'user') {
    return normalizeDatabaseUserId(currentValue) || '';
  }

  if (property.type === 'select') {
    const normalizedValue = normalizeDatabaseSelectValue(currentValue);

    if (!normalizedValue) {
      return '';
    }

    const selectedOption = getDatabaseSelectOption(property, normalizedValue);
    return selectedOption?.label || normalizedValue;
  }

  if (property.type === 'page_reference') {
    const pageId = normalizeDatabasePageReferenceValue(currentValue);

    if (!pageId) {
      return '';
    }

    return pageTitleById?.[pageId] || pageId;
  }

  if (property.type === 'checkbox') {
    return String(normalizeDatabaseCheckboxValue(currentValue));
  }

  if (typeof currentValue === 'string') {
    return normalizeSerializedDatabaseString(currentValue);
  }

  if (currentValue === null || typeof currentValue === 'undefined') {
    return '';
  }

  return JSON.stringify(currentValue);
}

/**
 * Builds contract-compatible payload for batch update API by property type.
 */
export function buildDatabaseCellPayloadValue(property: IDatabaseProperty, value: unknown): unknown {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (property.type === 'checkbox') {
    return normalizeDatabaseCheckboxValue(currentValue);
  }

  if (property.type === 'user') {
    const userId = normalizeDatabaseUserId(currentValue);
    return userId ? { id: userId } : null;
  }

  if (property.type === 'page_reference') {
    const pageId = normalizeDatabasePageReferenceValue(currentValue).trim();
    return pageId || null;
  }

  if (property.type === 'select') {
    const selectValue = normalizeDatabaseSelectValue(currentValue);
    return selectValue || null;
  }

  if (typeof currentValue === 'string') {
    return normalizeSerializedDatabaseString(currentValue);
  }

  return currentValue ?? '';
}

