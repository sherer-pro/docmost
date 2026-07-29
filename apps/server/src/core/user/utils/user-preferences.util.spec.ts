import {
  normalizeAiPanelWidth,
  normalizeAsideTabPreference,
  normalizeBooleanPreferenceByPageId,
  normalizePageEditModeByPageId,
  normalizeNotificationFrequency,
  normalizePageEditModePreference,
  normalizePreferenceBoolean,
  normalizeUserSettings,
} from './user-preferences.util';

const PAGE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_PAGE_ID = '00000000-0000-4000-8000-000000000002';

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
    expect(normalizePageEditModePreference('invalid')).toBeNull();
  });

  it('normalizes page edit mode map and drops invalid values', () => {
    expect(
      normalizePageEditModeByPageId({
        [PAGE_ID]: '"read"',
        [OTHER_PAGE_ID]: 'EDIT',
        '00000000-0000-4000-8000-000000000003': 'invalid',
        'not-a-page-id': 'edit',
        '': 'edit',
      }),
    ).toEqual({
      [PAGE_ID]: 'read',
      [OTHER_PAGE_ID]: 'edit',
    });
  });

  it('normalizes AI panel preferences', () => {
    expect(normalizeAiPanelWidth('420')).toBe(420);
    expect(normalizeAiPanelWidth(100)).toBe(300);
    expect(normalizeAiPanelWidth(1000)).toBe(600);
    expect(normalizeAiPanelWidth('invalid', 360)).toBe(360);
    expect(normalizeAsideTabPreference('"ai"')).toBe('ai');
    expect(normalizeAsideTabPreference('invalid', 'comments')).toBe('comments');
  });

  it('normalizes boolean page preference maps', () => {
    expect(
      normalizeBooleanPreferenceByPageId({
        [PAGE_ID]: true,
        [OTHER_PAGE_ID]: false,
        invalid: 'true',
        '': true,
      }),
    ).toEqual({
      [PAGE_ID]: true,
      [OTHER_PAGE_ID]: false,
    });
    expect(
      normalizeBooleanPreferenceByPageId(
        JSON.stringify({ [PAGE_ID]: false }),
      ),
    ).toEqual({ [PAGE_ID]: false });
  });

  it('normalizes settings payload and preserves unrelated preference keys', () => {
    const normalized = normalizeUserSettings({
      preferences: {
        pushEnabled: 'true',
        emailEnabled: '"false"',
        pushFrequency: '"24h"',
        emailFrequency: '"1h"',
        aiPanelOpen: '"true"',
        aiPanelWidth: '420',
        aiPanelTab: '"ai"',
        pageEditModeByPageId: {
          [PAGE_ID]: '"read"',
          [OTHER_PAGE_ID]: '"edit"',
          '00000000-0000-4000-8000-000000000003': 'invalid',
        },
        headingNumberingByPageId: {
          [PAGE_ID]: false,
          invalid: 'false',
        },
        rememberPageScrollPosition: true,
      },
    });

    expect(normalized.preferences.pushEnabled).toBe(true);
    expect(normalized.preferences.emailEnabled).toBe(false);
    expect(normalized.preferences.pushFrequency).toBe('24h');
    expect(normalized.preferences.emailFrequency).toBe('1h');
    expect(normalized.preferences.aiPanelOpen).toBe(true);
    expect(normalized.preferences.aiPanelWidth).toBe(420);
    expect(normalized.preferences.aiPanelTab).toBe('ai');
    expect(normalized.preferences.pageEditModeByPageId).toEqual({
      [PAGE_ID]: 'read',
      [OTHER_PAGE_ID]: 'edit',
    });
    expect(normalized.preferences.headingNumberingByPageId).toEqual({
      [PAGE_ID]: false,
    });
    expect(normalized.preferences.rememberPageScrollPosition).toBe(true);
  });
});
