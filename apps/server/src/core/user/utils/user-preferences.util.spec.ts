import {
  normalizeNotificationFrequency,
  normalizePageEditModePreference,
  normalizePreferenceBoolean,
  normalizeUserSettings,
} from './user-preferences.util';

describe('user-preferences.util', () => {
  it('normalizes boolean preferences from string payloads', () => {
    expect(normalizePreferenceBoolean('false', true)).toBe(false);
    expect(normalizePreferenceBoolean('"true"', false)).toBe(true);
    expect(normalizePreferenceBoolean('invalid', true)).toBe(true);
  });

  it('normalizes notification frequencies from quoted values', () => {
    expect(normalizeNotificationFrequency('"24h"', 'immediate')).toBe('24h');
    expect(normalizeNotificationFrequency('"1H"', 'immediate')).toBe('1h');
    expect(normalizeNotificationFrequency('invalid', '3h')).toBe('3h');
  });

  it('normalizes page edit mode from quoted values', () => {
    expect(normalizePageEditModePreference('"read"')).toBe('read');
    expect(normalizePageEditModePreference('"EDIT"')).toBe('edit');
    expect(normalizePageEditModePreference('invalid')).toBe('edit');
  });

  it('normalizes settings payload and preserves unrelated preference keys', () => {
    const normalized = normalizeUserSettings({
      preferences: {
        pushEnabled: 'true',
        emailEnabled: '"false"',
        pushFrequency: '"24h"',
        emailFrequency: '"1h"',
        pageEditMode: '"read"',
        rememberPageScrollPosition: true,
      },
    });

    expect(normalized.preferences.pushEnabled).toBe(true);
    expect(normalized.preferences.emailEnabled).toBe(false);
    expect(normalized.preferences.pushFrequency).toBe('24h');
    expect(normalized.preferences.emailFrequency).toBe('1h');
    expect(normalized.preferences.pageEditMode).toBe('read');
    expect(normalized.preferences.rememberPageScrollPosition).toBe(true);
  });
});
