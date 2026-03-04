import { IDatabaseProperty, IDatabaseSelectOption, IDatabaseSelectPropertySettings } from '@/features/database/types/database.types';

interface LegacyCellValueContainer {
  value: unknown;
  rawValueBeforeTypeChange: unknown;
}

interface DatabaseCellDisplayValueParams {
  property?: IDatabaseProperty;
  value: unknown;
  pageTitleById?: Record<string, string>;
}

/**
 * Возвращает актуальное значение ячейки из fallback-контейнера,
 * который используется после смены типа свойства.
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
 * Нормализует значение пользователя до `id`.
 * Поддерживаются контрактные формы: `string | { id: string } | null`.
 */
export function normalizeDatabaseUserId(value: unknown): string | null {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (typeof currentValue === 'string') {
    const trimmedValue = currentValue.trim();
    return trimmedValue || null;
  }

  if (currentValue && typeof currentValue === 'object' && 'id' in currentValue) {
    const candidateId = (currentValue as { id?: unknown }).id;

    if (typeof candidateId === 'string') {
      const trimmedId = candidateId.trim();
      return trimmedId || null;
    }
  }

  return null;
}

/**
 * Нормализует select-значение до строкового `value`.
 * Поддерживает как прямую строку, так и fallback-объект после смены типа.
 */
export function normalizeDatabaseSelectValue(value: unknown): string {
  const currentValue = extractCurrentDatabaseCellValue(value);
  return typeof currentValue === 'string' ? currentValue : '';
}

/**
 * Нормализует page_reference до строкового `pageId`.
 * Поддерживает как прямую строку, так и fallback-объект после смены типа.
 */
export function normalizeDatabasePageReferenceValue(value: unknown): string {
  const currentValue = extractCurrentDatabaseCellValue(value);
  return typeof currentValue === 'string' ? currentValue : '';
}

/**
 * Возвращает настройки select-свойства в безопасном, типизированном формате.
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
 * Ищет select-опцию по текущему value.
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
 * Возвращает отображаемое строковое значение для фильтрации/сортировки/экспорта,
 * чтобы UI и markdown использовали один и тот же display-модель.
 */
export function getDatabaseCellDisplayValue({
  property,
  value,
  pageTitleById,
}: DatabaseCellDisplayValueParams): string {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (!property) {
    if (typeof currentValue === 'string') {
      return currentValue;
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
    return String(Boolean(currentValue));
  }

  if (typeof currentValue === 'string') {
    return currentValue;
  }

  if (currentValue === null || typeof currentValue === 'undefined') {
    return '';
  }

  return JSON.stringify(currentValue);
}

/**
 * Строит контрактный payload для batch update API по типу свойства.
 */
export function buildDatabaseCellPayloadValue(property: IDatabaseProperty, value: unknown): unknown {
  const currentValue = extractCurrentDatabaseCellValue(value);

  if (property.type === 'checkbox') {
    return Boolean(currentValue);
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
    return currentValue;
  }

  return currentValue ?? '';
}
