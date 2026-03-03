import {
  PAGE_CUSTOM_FIELD_STATUS_VALUES,
  UpdatePageCustomFieldsDto,
} from '../dto/update-page.dto';

/**
 * Единый mapper API-контракта страницы.
 *
 * Нормализует `settings` до стабильного формата:
 * - объект -> возвращаем как есть;
 * - null/undefined/не-объект -> возвращаем `undefined`.
 */
export function mapPageSettings(
  settings: unknown,
): Record<string, unknown> | undefined {
  if (!settings || typeof settings !== 'object') {
    return undefined;
  }

  return settings as Record<string, unknown>;
}

/**
 * Возвращает контракт custom document fields, который ожидает клиент.
 */
export function mapPageCustomFields(page: {
  settings?: unknown;
}): UpdatePageCustomFieldsDto {
  const settings = mapPageSettings(page.settings) ?? {};
  const status =
    typeof settings.status === 'string' &&
    (PAGE_CUSTOM_FIELD_STATUS_VALUES as readonly string[]).includes(
      settings.status,
    )
      ? (settings.status as UpdatePageCustomFieldsDto['status'])
      : null;
  const assigneeId =
    typeof settings.assigneeId === 'string' ? settings.assigneeId : null;

  return {
    status,
    assigneeId,
    stakeholderIds: Array.isArray(settings.stakeholderIds)
      ? settings.stakeholderIds
      : [],
  };
}

/**
 * Нормализует API-ответ страницы в одном месте.
 */
export function mapPageResponse<T extends { settings?: unknown }>(
  page: T,
  options?: { includeCustomFields?: boolean },
) {
  const includeCustomFields = options?.includeCustomFields ?? false;

  return {
    ...page,
    settings: mapPageSettings(page.settings),
    ...(includeCustomFields ? { customFields: mapPageCustomFields(page) } : {}),
  };
}
