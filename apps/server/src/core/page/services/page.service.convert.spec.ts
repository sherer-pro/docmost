jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { PageService } from './page.service';

describe('PageService convertPageToDatabase reversibility', () => {
  const pageRepo = {
    findById: jest.fn(),
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
  const pageHistoryRecorder = {
    recordPageEvent: jest.fn(),
  };

  const trx = {};
  const linkedInstanceQuery: any = {
    select: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    executeTakeFirst: jest.fn(),
  };
  for (const method of ['select', 'where', 'limit']) {
    linkedInstanceQuery[method].mockReturnValue(linkedInstanceQuery);
  }
  const db = {
    selectFrom: jest.fn(() => linkedInstanceQuery),
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
    databaseRepo as any,
    databaseRowRepo as any,
    databaseCellRepo as any,
    databasePropertyRepo as any,
    databaseViewRepo as any,
    {} as any,
    {} as any,
    pageHistoryRecorder as any,
    {} as any,
    {} as any,
  );
  const hasTemplateInPageTree = jest.spyOn(
    service as any,
    'hasTemplateInPageTree',
  );
  const hasLinkedTemplateInstanceInPageTree = jest.spyOn(
    service as any,
    'hasLinkedTemplateInstanceInPageTree',
  );

  beforeEach(() => {
    jest.clearAllMocks();
    linkedInstanceQuery.executeTakeFirst.mockResolvedValue(undefined);
    hasTemplateInPageTree.mockResolvedValue(false);
    hasLinkedTemplateInstanceInPageTree.mockResolvedValue(false);
  });

  it('restores archived database rows/cells recursively for nested pages', async () => {
    const page = {
      id: 'page-root',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      title: 'Root',
      icon: '📚',
      templateKind: null,
    } as any;
    pageRepo.findById.mockResolvedValue(page);

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
    expect(pageHistoryRecorder.recordPageEvent).toHaveBeenCalledWith({
      pageId: 'page-root',
      actorId: 'user-1',
      changeType: 'page.converted.to-database',
      changeData: {
        databaseId: 'db-archived',
        conversion: {
          direction: 'page-to-database',
        },
      },
    });
  });

  it('rejects conversion of a linked synchronized template instance', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'linked-page',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      templateKind: null,
      deletedAt: null,
    });
    hasLinkedTemplateInstanceInPageTree.mockResolvedValue(true);

    await expect(
      service.convertPageToDatabase(
        {
          id: 'linked-page',
          spaceId: 'space-1',
          workspaceId: 'ws-1',
          templateKind: null,
        } as any,
        'user-1',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_linked_page_convert_forbidden',
      }),
    });
    expect(databaseRepo.findByPageIdIncludingDeleted).not.toHaveBeenCalled();
  });

  it('rejects conversion when an ordinary parent contains a template source', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'parent-page',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
      templateKind: null,
      deletedAt: null,
    });
    hasTemplateInPageTree.mockResolvedValue(true);

    await expect(
      service.convertPageToDatabase(
        {
          id: 'parent-page',
          spaceId: 'space-1',
          workspaceId: 'ws-1',
          templateKind: null,
        } as any,
        'user-1',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_source_convert_forbidden',
      }),
    });
    expect(hasTemplateInPageTree).toHaveBeenCalledWith(
      'parent-page',
      'ws-1',
      trx,
      false,
    );
    expect(databaseRepo.findByPageIdIncludingDeleted).not.toHaveBeenCalled();
  });
});
