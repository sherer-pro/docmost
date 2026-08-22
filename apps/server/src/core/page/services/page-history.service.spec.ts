import { PageHistoryService } from './page-history.service';

describe('PageHistoryService', () => {
  const createService = () => {
    const pageHistoryRepo = {
      findById: jest.fn(),
      findMetadataById: jest.fn(),
      findPageHistoryByPageId: jest.fn(),
      deleteById: jest.fn(),
    };
    const userRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
    };
    const pageRepo = {
      findById: jest.fn(),
      findReferencesByIds: jest.fn().mockResolvedValue([]),
    };
    const databasePropertyRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn().mockResolvedValue({
        capabilities: { canRead: true },
      }),
      getEffectiveAccessForPages: jest.fn().mockResolvedValue(new Map()),
    };

    const service = new PageHistoryService(
      pageHistoryRepo as any,
      userRepo as any,
      pageRepo as any,
      databasePropertyRepo as any,
      pageAccessService as any,
    );

    return {
      service,
      pageHistoryRepo,
      userRepo,
      pageRepo,
      databasePropertyRepo,
      pageAccessService,
    };
  };

  it('loads history entry by id with content', async () => {
    const { service, pageHistoryRepo } = createService();
    const history = { id: 'history-1', content: { type: 'doc' } };

    pageHistoryRepo.findById.mockResolvedValue(history);

    await expect(service.findById('history-1')).resolves.toEqual(history);
    expect(pageHistoryRepo.findById).toHaveBeenCalledWith('history-1', {
      includeContent: true,
    });
  });

  it('loads paginated history for page', async () => {
    const { service, pageHistoryRepo } = createService();
    const pagination = { limit: 20, cursor: 'cursor-value' };
    const paginatedResult = { items: [{ id: 'history-1' }], meta: {} };

    pageHistoryRepo.findPageHistoryByPageId.mockResolvedValue(paginatedResult);

    await expect(
      service.findHistoryByPageId('page-1', pagination as any),
    ).resolves.toEqual(paginatedResult);

    expect(pageHistoryRepo.findPageHistoryByPageId).toHaveBeenCalledWith(
      'page-1',
      pagination,
    );
  });

  it('loads history metadata without content for authorization checks', async () => {
    const { service, pageHistoryRepo } = createService();
    const history = { id: 'history-1', workspaceId: 'workspace-1' };

    pageHistoryRepo.findMetadataById.mockResolvedValue(history);

    await expect(service.findMetadataById('history-1')).resolves.toEqual(
      history,
    );
    expect(pageHistoryRepo.findMetadataById).toHaveBeenCalledWith('history-1');
  });

  it('deletes a history entry by id', async () => {
    const { service, pageHistoryRepo } = createService();

    await expect(service.deleteById('history-1')).resolves.toBeUndefined();
    expect(pageHistoryRepo.deleteById).toHaveBeenCalledWith('history-1');
  });

  it('enriches readable values for legacy row cell changes on read', async () => {
    const {
      service,
      pageHistoryRepo,
      userRepo,
      pageRepo,
      databasePropertyRepo,
      pageAccessService,
    } = createService();
    const history = {
      id: 'history-1',
      workspaceId: 'ws-1',
      changeType: 'database.row.cells.updated',
      changeData: {
        changes: [
          {
            propertyId: 'prop-user',
            propertyType: 'user',
            oldValue: null,
            newValue: '{"id":"user-1"}',
          },
          {
            propertyId: 'prop-page',
            propertyType: 'page_reference',
            oldValue: 'page-1',
            newValue: 'page-2',
          },
          {
            propertyId: 'prop-select',
            propertyType: 'select',
            oldValue: 'metka-2-r311',
            newValue: 'metka-4-2ejm',
          },
        ],
      },
      content: { type: 'doc' },
    };

    pageHistoryRepo.findById.mockResolvedValue(history);
    userRepo.findByIds.mockResolvedValue([
      { id: 'user-1', name: 'Pavel', avatarUrl: null },
    ]);
    const pages: Record<string, any> = {
      'page-1': {
        id: 'page-1',
        workspaceId: 'ws-1',
        spaceId: 'space-1',
        title: 'Page One',
        slugId: 'page-one',
      },
      'page-2': {
        id: 'page-2',
        workspaceId: 'ws-1',
        spaceId: 'space-1',
        title: 'Page Two',
        slugId: 'page-two',
      },
    };
    pageRepo.findReferencesByIds.mockImplementation(async (pageIds) =>
      pageIds.map((pageId) => pages[pageId]).filter(Boolean),
    );
    pageAccessService.getEffectiveAccessForPages.mockImplementation(
      async (resolvedPages) =>
        new Map(
          resolvedPages.map((page) => [
            page.id,
            { capabilities: { canRead: true } },
          ]),
        ),
    );
    databasePropertyRepo.findByIds.mockResolvedValue([
      {
        id: 'prop-select',
        settings: {
          options: [
            { value: 'metka-2-r311', label: 'Метка 2' },
            { value: 'metka-4-2ejm', label: 'Метка 4' },
          ],
        },
      },
    ]);

    const result = await service.findById('history-1', {
      id: 'viewer-1',
      workspaceId: 'ws-1',
    } as any);
    const changes = (result.changeData as any).changes;

    expect(changes[0].newValue).toEqual({
      id: 'user-1',
      name: 'Pavel',
      avatarUrl: null,
    });
    expect(changes[1].oldValue).toEqual({
      id: 'page-1',
      title: 'Page One',
      slugId: 'page-one',
    });
    expect(changes[1].newValue).toEqual({
      id: 'page-2',
      title: 'Page Two',
      slugId: 'page-two',
    });
    expect(changes[2].oldValue).toEqual({
      value: 'metka-2-r311',
      label: 'Метка 2',
    });
    expect(changes[2].newValue).toEqual({
      value: 'metka-4-2ejm',
      label: 'Метка 4',
    });
    expect(userRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(userRepo.findById).not.toHaveBeenCalled();
    expect(pageRepo.findReferencesByIds).toHaveBeenCalledTimes(1);
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(databasePropertyRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(databasePropertyRepo.findById).not.toHaveBeenCalled();
    expect(
      pageAccessService.getEffectiveAccessForPages,
    ).toHaveBeenCalledTimes(1);
  });

  it('enriches one hundred history user references with one repository query', async () => {
    const { service, pageHistoryRepo, userRepo } = createService();
    const userIds = Array.from(
      { length: 100 },
      (_, index) => `history-user-${index}`,
    );
    pageHistoryRepo.findPageHistoryByPageId.mockResolvedValue({
      items: userIds.map((userId, index) => ({
        id: `history-${index}`,
        workspaceId: 'ws-1',
        changeType: 'page.custom-fields.updated',
        changeData: {
          changes: [
            {
              field: 'assigneeId',
              oldValue: null,
              newValue: userId,
            },
          ],
        },
      })),
      meta: {},
    });
    userRepo.findByIds.mockResolvedValue(
      userIds.map((id, index) => ({
        id,
        name: `History User ${index}`,
        avatarUrl: null,
      })),
    );

    const result = await service.findHistoryByPageId(
      'row-page',
      { limit: 100 } as any,
    );

    expect(result.items).toHaveLength(100);
    expect(userRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(userRepo.findByIds).toHaveBeenCalledWith(userIds, 'ws-1');
    expect(userRepo.findById).not.toHaveBeenCalled();
  });

  it('does not expose page reference metadata without viewer access', async () => {
    const { service, pageHistoryRepo, pageRepo, pageAccessService } =
      createService();
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(
      new Map([
        ['restricted-page', { capabilities: { canRead: false } }],
      ]),
    );
    const restrictedHistory = {
      id: 'history-1',
      workspaceId: 'ws-1',
      changeType: 'database.row.cells.updated',
      changeData: {
        changes: [
          {
            propertyId: 'prop-page',
            propertyType: 'page_reference',
            oldValue: null,
            newValue: {
              id: 'restricted-page',
              title: 'G09_CANARY_HISTORY_SECRET',
              slugId: 'restricted-page-slug',
            },
          },
        ],
      },
    };
    pageHistoryRepo.findById.mockResolvedValue(restrictedHistory);
    pageHistoryRepo.findPageHistoryByPageId.mockResolvedValue({
      items: [restrictedHistory],
      meta: {},
    });
    pageRepo.findReferencesByIds.mockResolvedValue([
      {
        id: 'restricted-page',
        workspaceId: 'ws-1',
        spaceId: 'space-1',
        title: 'G09_CANARY_HISTORY_SECRET',
        slugId: 'restricted-page-slug',
      },
    ]);

    const result = await service.findById('history-1', {
      id: 'viewer-1',
      workspaceId: 'ws-1',
    } as any);
    const changes = (result.changeData as any).changes;

    expect(changes[0].newValue).toBeNull();
    expect(JSON.stringify(result)).not.toContain('G09_CANARY_HISTORY_SECRET');

    const listResult = await service.findHistoryByPageId(
      'row-page',
      { limit: 20 } as any,
      { id: 'viewer-1', workspaceId: 'ws-1' } as any,
    );
    expect(JSON.stringify(listResult)).not.toContain(
      'G09_CANARY_HISTORY_SECRET',
    );
  });
});
