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
    };
    const pageRepo = {
      findById: jest.fn(),
    };
    const databasePropertyRepo = {
      findById: jest.fn(),
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn().mockResolvedValue({
        capabilities: { canRead: true },
      }),
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
    userRepo.findById.mockResolvedValue({
      id: 'user-1',
      name: 'Pavel',
      avatarUrl: null,
    });
    pageRepo.findById.mockImplementation(async (pageId: string) => {
      const pages: Record<string, any> = {
        'page-1': {
          id: 'page-1',
          workspaceId: 'ws-1',
          deletedAt: null,
          title: 'Page One',
          slugId: 'page-one',
        },
        'page-2': {
          id: 'page-2',
          workspaceId: 'ws-1',
          deletedAt: null,
          title: 'Page Two',
          slugId: 'page-two',
        },
      };

      return pages[pageId] ?? null;
    });
    databasePropertyRepo.findById.mockResolvedValue({
      id: 'prop-select',
      settings: {
        options: [
          { value: 'metka-2-r311', label: 'Метка 2' },
          { value: 'metka-4-2ejm', label: 'Метка 4' },
        ],
      },
    });

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
  });

  it('does not expose page reference metadata without viewer access', async () => {
    const { service, pageHistoryRepo, pageRepo, pageAccessService } =
      createService();
    pageAccessService.getEffectiveAccess.mockResolvedValue({
      capabilities: { canRead: false },
    });
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
    pageRepo.findById.mockResolvedValue({
      id: 'restricted-page',
      workspaceId: 'ws-1',
      deletedAt: null,
      title: 'G09_CANARY_HISTORY_SECRET',
      slugId: 'restricted-page-slug',
    });

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
