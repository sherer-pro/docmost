jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { PageService } from './page.service';

describe('PageService custom fields history', () => {
  const pageRepo = {
    updatePage: jest.fn(),
    findById: jest.fn(),
  };
  const recipientResolverService = {
    resolveAssignmentDelta: jest.fn(() => ({
      newAssigneeId: null,
      newStakeholderIds: [],
    })),
  };
  const pageHistoryRecorder = {
    enqueuePageEvent: jest.fn(),
  };
  const spaceRepo = {
    findById: jest.fn(),
  };
  const userRepo = {
    findById: jest.fn(),
  };
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  const service = new PageService(
    pageRepo as any,
    {} as any,
    {} as any,
    {} as any,
    queue as any,
    {} as any,
    queue as any,
    queue as any,
    {} as any,
    {} as any,
    {} as any,
    recipientResolverService as any,
    { findByPageId: jest.fn().mockResolvedValue(null) } as any,
    { findActiveByPageId: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    {} as any,
    {} as any,
    spaceRepo as any,
    userRepo as any,
    pageHistoryRecorder as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Title',
      icon: null,
      coverPhoto: null,
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      creatorId: 'user-1',
      lastUpdatedById: 'user-1',
      contributorIds: ['user-1'],
      content: { type: 'doc' },
      settings: { status: 'TODO' },
    });
    userRepo.findById.mockResolvedValue({
      id: 'user-2',
      name: 'Test User',
    });
  });

  it('records custom field history when space field is enabled', async () => {
    spaceRepo.findById.mockResolvedValue({
      settings: {
        documentFields: {
          status: true,
        },
      },
    });

    await service.update(
      {
        id: 'page-1',
        spaceId: 'space-1',
        workspaceId: 'ws-1',
        creatorId: 'user-1',
        lastUpdatedById: 'user-1',
        contributorIds: ['user-1'],
        settings: { status: 'TODO' },
      } as any,
      {
        toSettingsPayload: jest.fn(() => ({ status: 'DONE' })),
      } as any,
      { id: 'user-2' } as any,
    );

    expect(pageHistoryRecorder.enqueuePageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        actorId: 'user-2',
        changeType: 'page.custom-fields.updated',
      }),
    );
  });

  it('does not record custom field history when field is disabled in space settings', async () => {
    spaceRepo.findById.mockResolvedValue({
      settings: {
        documentFields: {
          status: false,
        },
      },
    });

    await service.update(
      {
        id: 'page-1',
        spaceId: 'space-1',
        workspaceId: 'ws-1',
        creatorId: 'user-1',
        lastUpdatedById: 'user-1',
        contributorIds: ['user-1'],
        settings: { status: 'TODO' },
      } as any,
      {
        toSettingsPayload: jest.fn(() => ({ status: 'DONE' })),
      } as any,
      { id: 'user-2' } as any,
    );

    expect(pageHistoryRecorder.enqueuePageEvent).not.toHaveBeenCalled();
  });

  it('stores display names for assignee and stakeholders in custom fields history', async () => {
    spaceRepo.findById.mockResolvedValue({
      settings: {
        documentFields: {
          assignee: true,
          stakeholders: true,
        },
      },
    });

    userRepo.findById.mockImplementation(async (userId: string) => {
      const users: Record<string, { id: string; name: string }> = {
        'user-old': { id: 'user-old', name: 'Old User' },
        'user-new': { id: 'user-new', name: 'New User' },
        'stakeholder-1': { id: 'stakeholder-1', name: 'Stakeholder One' },
        'stakeholder-2': { id: 'stakeholder-2', name: 'Stakeholder Two' },
      };

      return users[userId] ?? null;
    });

    await service.update(
      {
        id: 'page-1',
        spaceId: 'space-1',
        workspaceId: 'ws-1',
        creatorId: 'user-1',
        lastUpdatedById: 'user-1',
        contributorIds: ['user-1'],
        settings: {
          assigneeId: 'user-old',
          stakeholderIds: ['stakeholder-1'],
        },
      } as any,
      {
        toSettingsPayload: jest.fn(() => ({
          assigneeId: 'user-new',
          stakeholderIds: ['stakeholder-2'],
        })),
      } as any,
      { id: 'user-2' } as any,
    );

    expect(pageHistoryRecorder.enqueuePageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        changeData: expect.objectContaining({
          changes: expect.arrayContaining([
            expect.objectContaining({
              field: 'assigneeId',
              oldValue: { id: 'user-old', name: 'Old User' },
              newValue: { id: 'user-new', name: 'New User' },
            }),
            expect.objectContaining({
              field: 'stakeholderIds',
              oldValue: [{ id: 'stakeholder-1', name: 'Stakeholder One' }],
              newValue: [{ id: 'stakeholder-2', name: 'Stakeholder Two' }],
            }),
          ]),
        }),
      }),
    );
  });
});
