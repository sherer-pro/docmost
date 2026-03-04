import { PageSettings } from '@docmost/db/types/entity.types';

/**
 * Safely normalizes an arbitrary `settings` payload to a plain page settings object.
 *
 * This keeps downstream logic deterministic even when the persisted value is
 * nullish or malformed.
 */
export function normalizePageSettings(settings: unknown): PageSettings {
  if (!settings || typeof settings !== 'object') {
    return {};
  }

  return settings as PageSettings;
}

/**
 * Extracts `assigneeId` from page settings.
 *
 * Returns only a non-empty string and falls back to `null` when the value is
 * absent or invalid.
 */
export function getPageAssigneeId(settings: unknown): string | null {
  const normalizedSettings = normalizePageSettings(settings);

  return typeof normalizedSettings.assigneeId === 'string' && normalizedSettings.assigneeId
    ? normalizedSettings.assigneeId
    : null;
}

/**
 * Extracts and filters `stakeholderIds` from page settings.
 *
 * Rules:
 * - keep only non-empty strings;
 * - remove duplicates;
 * - preserve first-seen order.
 */
export function getPageStakeholderIds(settings: unknown): string[] {
  const normalizedSettings = normalizePageSettings(settings);

  if (!Array.isArray(normalizedSettings.stakeholderIds)) {
    return [];
  }

  return [...new Set(normalizedSettings.stakeholderIds.filter(isNonEmptyString))];
}

/**
 * Builds a unique recipient list from page role settings:
 * assignee + stakeholders.
 */
export function getPageRoleRecipientIds(settings: unknown): string[] {
  const assigneeId = getPageAssigneeId(settings);
  const stakeholderIds = getPageStakeholderIds(settings);

  return [...new Set([...(assigneeId ? [assigneeId] : []), ...stakeholderIds])];
}

/**
 * Local type guard for user identifier arrays.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
