import { PageHistoryService } from './page-history.service';

describe('PageHistoryService', () => {
  const createService = () => {
    const pageHistoryRepo = {
      findById: jest.fn(),
      findPageHistoryByPageId: jest.fn(),
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

    const service = new PageHistoryService(
      pageHistoryRepo as any,
      userRepo as any,
      pageRepo as any,
      databasePropertyRepo as any,
    );

    return { service, pageHistoryRepo, userRepo, pageRepo, databasePropertyRepo };
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

  it('enriches readable values for legacy row cell changes on read', async () => {
    const { service, pageHistoryRepo, userRepo, pageRepo, databasePropertyRepo } = createService();
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

    const result = await service.findById('history-1');
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
});
