import { PageHistoryService } from './page-history.service';

describe('PageHistoryService', () => {
  const createService = () => {
    const pageHistoryRepo = {
      findById: jest.fn(),
      findPageHistoryByPageId: jest.fn(),
    };

    const service = new PageHistoryService(pageHistoryRepo as any);

    return { service, pageHistoryRepo };
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
});
