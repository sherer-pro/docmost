import {
  PAGE_CUSTOM_FIELD_STATUS_VALUES,
  UpdatePageCustomFieldsDto,
} from '../dto/update-page.dto';
import {
  getPageAssigneeId,
  getPageStakeholderIds,
  normalizePageSettings,
} from '../utils/page-settings.utils';

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
  const normalizedSettings = normalizePageSettings(settings);

  return Object.keys(normalizedSettings).length > 0
    ? (normalizedSettings as Record<string, unknown>)
    : undefined;
}

/**
 * Returns the custom document fields contract expected by the client.
 */
export function mapPageCustomFields(page: {
  settings?: unknown;
}): UpdatePageCustomFieldsDto {
  const settings = normalizePageSettings(page.settings);
  const status =
    typeof settings.status === 'string' &&
    (PAGE_CUSTOM_FIELD_STATUS_VALUES as readonly string[]).includes(
      settings.status,
    )
      ? (settings.status as UpdatePageCustomFieldsDto['status'])
      : null;
  const assigneeId = getPageAssigneeId(settings);

  return {
    status,
    assigneeId,
    stakeholderIds: getPageStakeholderIds(settings),
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
