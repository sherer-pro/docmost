export type NotificationFrequency = 'immediate' | '1h' | '3h' | '6h' | '24h';
export type PageEditModePreference = 'read' | 'edit';

const NOTIFICATION_FREQUENCIES: NotificationFrequency[] = [
  'immediate',
  '1h',
  '3h',
  '6h',
  '24h',
];

interface UserPreferencesRecord {
  [key: string]: unknown;
  pushEnabled?: unknown;
  emailEnabled?: unknown;
  pushFrequency?: unknown;
  emailFrequency?: unknown;
  pageEditMode?: unknown;
}

interface UserSettingsRecord {
  [key: string]: unknown;
  preferences?: UserPreferencesRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripEnclosingQuotes(value: string): string {
  let normalized = value.trim();

  for (let i = 0; i < 5; i += 1) {
    if (
      normalized.length >= 2 &&
      normalized.startsWith('"') &&
      normalized.endsWith('"')
    ) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return normalized;
}

export function normalizePreferenceString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = stripEnclosingQuotes(value);
  return normalized.length > 0 ? normalized : null;
}

export function normalizePreferenceBoolean(
  value: unknown,
  fallback: boolean,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalizedString = normalizePreferenceString(value)?.toLowerCase();
  if (normalizedString === 'true') {
    return true;
  }

  if (normalizedString === 'false') {
    return false;
  }

  return fallback;
}

export function normalizeNotificationFrequency(
  value: unknown,
  fallback: NotificationFrequency = 'immediate',
): NotificationFrequency {
  const normalizedString = normalizePreferenceString(value)?.toLowerCase();
  if (!normalizedString) {
    return fallback;
  }

  if (
    NOTIFICATION_FREQUENCIES.includes(
      normalizedString as NotificationFrequency,
    )
  ) {
    return normalizedString as NotificationFrequency;
  }

  return fallback;
}

export function normalizePageEditModePreference(
  value: unknown,
): PageEditModePreference {
  const normalizedString = normalizePreferenceString(value)?.toLowerCase();
  return normalizedString === 'read' ? 'read' : 'edit';
}

export function normalizeUserSettings(
  settings: unknown,
): UserSettingsRecord & {
  preferences: UserPreferencesRecord & {
    pushEnabled: boolean;
    emailEnabled: boolean;
    pushFrequency: NotificationFrequency;
    emailFrequency: NotificationFrequency;
    pageEditMode: PageEditModePreference;
  };
} {
  const safeSettings: UserSettingsRecord = isRecord(settings)
    ? (settings as UserSettingsRecord)
    : {};
  const safePreferences: UserPreferencesRecord = isRecord(safeSettings.preferences)
    ? (safeSettings.preferences as UserPreferencesRecord)
    : {};

  return {
    ...safeSettings,
    preferences: {
      ...safePreferences,
      pushEnabled: normalizePreferenceBoolean(safePreferences.pushEnabled, false),
      emailEnabled: normalizePreferenceBoolean(safePreferences.emailEnabled, true),
      pushFrequency: normalizeNotificationFrequency(
        safePreferences.pushFrequency,
        'immediate',
      ),
      emailFrequency: normalizeNotificationFrequency(
        safePreferences.emailFrequency,
        'immediate',
      ),
      pageEditMode: normalizePageEditModePreference(safePreferences.pageEditMode),
    },
  };
}
