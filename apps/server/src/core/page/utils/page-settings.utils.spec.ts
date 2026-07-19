import {
  getPageAiRole,
  getPageAssigneeId,
  getPageRoleRecipientIds,
  getPageStakeholderIds,
  normalizePageSettings,
} from './page-settings.utils';
import { PAGE_AI_ROLE } from '@docmost/api-contract';

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

  it('normalizes missing and invalid AI role values to NONE', () => {
    expect(getPageAiRole(undefined)).toBe(PAGE_AI_ROLE.NONE);
    expect(getPageAiRole({ aiRole: 'invalid' })).toBe(
      PAGE_AI_ROLE.NONE,
    );
    expect(getPageAiRole({ aiRole: 'AUTHOR' })).toBe(
      PAGE_AI_ROLE.AUTHOR,
    );
  });
});
