jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { PageService } from './page.service';

describe('PageService convertPageToDatabase reversibility', () => {
  const pageRepo = {
    getPageAndDescendants: jest.fn(),
  };

  const databaseRepo = {
    findByPageIdIncludingDeleted: jest.fn(),
    restoreDatabase: jest.fn(),
    insertDatabase: jest.fn(),
  };

  const databaseRowRepo = {
    findByDatabaseAndPage: jest.fn(),
    restoreRowLink: jest.fn(),
    insertRow: jest.fn(),
  };

  const databaseCellRepo = {
    restoreByDatabaseId: jest.fn(),
  };

  const databasePropertyRepo = {
    restoreByDatabaseId: jest.fn(),
  };

  const databaseViewRepo = {
    restoreByDatabaseId: jest.fn(),
  };

  const trx = {};
  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn(async (cb) => cb(trx)),
    })),
  };

  const service = new PageService(
    pageRepo as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    databaseRepo as any,
    databaseRowRepo as any,
    databaseCellRepo as any,
    databasePropertyRepo as any,
    databaseViewRepo as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restores archived database rows/cells recursively for nested pages', async () => {
    const page = {
      id: 'page-root',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      title: 'Root',
      icon: '📚',
    } as any;

    databaseRepo.findByPageIdIncludingDeleted.mockResolvedValue({
      id: 'db-archived',
      deletedAt: new Date(),
    });
    databaseRepo.restoreDatabase.mockResolvedValue({ id: 'db-archived' });

    pageRepo.getPageAndDescendants.mockResolvedValue([
      { id: 'page-root' },
      { id: 'row-a' },
      { id: 'row-a-nested' },
      { id: 'row-b' },
    ]);

    databaseRowRepo.findByDatabaseAndPage
      .mockResolvedValueOnce({ pageId: 'row-a', archivedAt: new Date() })
      .mockResolvedValueOnce({ pageId: 'row-a-nested', archivedAt: new Date() })
      .mockResolvedValueOnce(null);

    const result = await service.convertPageToDatabase(page, 'user-1');

    expect(result).toEqual({ databaseId: 'db-archived', pageId: 'page-root' });
    expect(databaseRepo.restoreDatabase).toHaveBeenCalledWith(
      'db-archived',
      'ws-1',
      { lastUpdatedById: 'user-1' },
      trx,
    );
    expect(databasePropertyRepo.restoreByDatabaseId).toHaveBeenCalledWith(
      'db-archived',
      'ws-1',
      trx,
    );
    expect(databaseCellRepo.restoreByDatabaseId).toHaveBeenCalledWith(
      'db-archived',
      'ws-1',
      trx,
    );
    expect(databaseViewRepo.restoreByDatabaseId).toHaveBeenCalledWith(
      'db-archived',
      'ws-1',
      trx,
    );

    expect(databaseRowRepo.restoreRowLink).toHaveBeenCalledTimes(2);
    expect(databaseRowRepo.insertRow).toHaveBeenCalledTimes(1);
    expect(databaseRowRepo.insertRow).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: 'db-archived',
        pageId: 'row-b',
        workspaceId: 'ws-1',
      }),
      trx,
    );
  });
});
