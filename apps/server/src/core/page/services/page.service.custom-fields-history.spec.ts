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
    recordPageEvent: jest.fn(),
  };
  const spaceRepo = {
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

    expect(pageHistoryRecorder.recordPageEvent).toHaveBeenCalledWith(
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

    expect(pageHistoryRecorder.recordPageEvent).not.toHaveBeenCalled();
  });
});
