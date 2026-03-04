import { mapPageCustomFields } from '../../page/mappers/page-response.mapper';
import { RecipientResolverService } from './recipient-resolver.service';

describe('RecipientResolverService', () => {
  const createService = (settings: unknown, usersWithAccess?: Set<string>) => {
    const db = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ settings }),
      }),
    } as any;

    const spaceMemberRepo = {
      getUserIdsWithSpaceAccess: jest
        .fn()
        .mockResolvedValue(usersWithAccess ?? new Set<string>()),
    } as any;

    return {
      service: new RecipientResolverService(db, spaceMemberRepo),
      spaceMemberRepo,
    };
  };

  it('keeps assignee and stakeholders extraction aligned with page mapper', () => {
    const settings = {
      assigneeId: 'user-1',
      stakeholderIds: ['user-2', '', 'user-3', 'user-2', null],
    };

    const { service } = createService(settings);
    const customFields = mapPageCustomFields({ settings });
    const delta = service.resolveAssignmentDelta({}, settings as any);

    expect(customFields.assigneeId).toBe(delta.newAssigneeId);
    expect(customFields.stakeholderIds).toEqual(delta.newStakeholderIds);
  });

  it('resolves page role recipients with the same normalized ids as mapper fields', async () => {
    const settings = {
      assigneeId: 'user-1',
      stakeholderIds: ['user-2', '', 'user-3', 'user-2', 1],
    };

    const { service } = createService(
      settings,
      new Set<string>(['user-1', 'user-2', 'user-3', 'user-4']),
    );

    const customFields = mapPageCustomFields({ settings });
    const recipients = await service.resolvePageRoleRecipients(
      'page-1',
      'space-1',
      'user-4',
    );

    expect(recipients).toEqual([
      customFields.assigneeId,
      ...customFields.stakeholderIds,
    ]);
  });
});
