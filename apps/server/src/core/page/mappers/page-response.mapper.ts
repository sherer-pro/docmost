import {
  PAGE_CUSTOM_FIELD_STATUS_VALUES,
  UpdatePageCustomFieldsDto,
} from '../dto/update-page.dto';

/**
 * Central mapper for the page API contract.
 *
 * Normalizes `settings` into a stable shape:
 * - object -> returns as is;
 * - null/undefined/non-object -> returns `undefined`.
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
 * Returns the custom document fields contract expected by the client.
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
 * Normalizes the page API response in one place.
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
