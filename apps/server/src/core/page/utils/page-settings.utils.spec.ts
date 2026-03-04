import {
  getPageAssigneeId,
  getPageRoleRecipientIds,
  getPageStakeholderIds,
  normalizePageSettings,
} from './page-settings.utils';

describe('page-settings.utils', () => {
  it('normalizes invalid settings to an empty object', () => {
    expect(normalizePageSettings(null)).toEqual({});
    expect(normalizePageSettings('invalid')).toEqual({});
  });

  it('extracts assignee and filters stakeholder ids deterministically', () => {
    const settings = {
      assigneeId: 'user-1',
      stakeholderIds: ['user-2', 'user-2', '', 1, 'user-3'],
    };

    expect(getPageAssigneeId(settings)).toBe('user-1');
    expect(getPageStakeholderIds(settings)).toEqual(['user-2', 'user-3']);
    expect(getPageRoleRecipientIds(settings)).toEqual(['user-1', 'user-2', 'user-3']);
  });
});
