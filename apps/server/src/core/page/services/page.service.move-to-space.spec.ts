jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { PageService } from './page.service';

describe('PageService movePageToSpace transaction boundary', () => {
  const rootPage = {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    parentPageId: null,
    deletedAt: null,
    templateKind: null,
  } as any;
  const childPage = {
    ...rootPage,
    id: '00000000-0000-4000-8000-000000000002',
    parentPageId: rootPage.id,
  } as any;
  const spaceQuery: any = {
    select: () => spaceQuery,
    where: () => spaceQuery,
    forUpdate: () => spaceQuery,
    execute: jest.fn(() =>
      Promise.resolve([
        { id: 'space-1', archivedAt: null },
        { id: 'space-2', archivedAt: null },
      ]),
    ),
  };
  const trxStub: any = new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === 'then') return undefined;
      if (property === 'selectFrom') return () => spaceQuery;
      if (property === 'execute' || property === 'executeTakeFirst') {
        return () => Promise.resolve([]);
      }
      return () => trxStub;
    },
  });
  const sequence: string[] = [];
  const eventEmitter = {
    emit: jest.fn((_event?: unknown, _payload?: unknown) =>
      sequence.push('event'),
    ),
    emitAsync: jest.fn(async (_event?: unknown, _payload?: unknown) => {
      sequence.push('event');
    }),
  };
  const pageRepo = {
    findById: jest.fn(),
    updatePage: jest.fn(),
    updatePages: jest.fn(),
    getPageAndDescendants: jest.fn(),
  };
  const attachmentRepo = {
    updateAttachmentsByPageId: jest.fn(),
  };
  const watcherService = {
    movePageWatchersToSpace: jest.fn(),
  };
  const databaseRowRepo = {
    findActiveByPageId: jest.fn(),
    archiveByPageIds: jest.fn(),
  };
  const pageAccessMutationService = {
    clearRulesByPageIds: jest.fn(),
  };
  const db = {
    transaction: () => ({
      execute: async (callback: (trx: any) => Promise<unknown>) => {
        sequence.push('transaction-start');
        const result = await callback(trxStub);
        sequence.push('transaction-commit');
        return result;
      },
    }),
  };

  function createService() {
    return new PageService(
      pageRepo as any,
      attachmentRepo as any,
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      eventEmitter as any,
      {} as any,
      watcherService as any,
      {} as any,
      {} as any,
      databaseRowRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pageAccessMutationService as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sequence.length = 0;
    pageRepo.findById.mockResolvedValue(rootPage);
    pageRepo.getPageAndDescendants.mockResolvedValue([rootPage, childPage]);
    databaseRowRepo.findActiveByPageId.mockResolvedValue(undefined);
    pageRepo.updatePage.mockImplementation(
      async (_data, _id, _trx, emitEvent = true) => {
        if (emitEvent) eventEmitter.emit('page.updated', {});
      },
    );
    pageRepo.updatePages.mockImplementation(
      async (_data, _ids, _trx, emitEvent = true) => {
        if (emitEvent) eventEmitter.emit('page.updated', {});
      },
    );
    attachmentRepo.updateAttachmentsByPageId.mockResolvedValue(undefined);
    watcherService.movePageWatchersToSpace.mockResolvedValue(undefined);
    pageAccessMutationService.clearRulesByPageIds.mockResolvedValue(undefined);
    spaceQuery.execute.mockResolvedValue([
      { id: 'space-1', archivedAt: null },
      { id: 'space-2', archivedAt: null },
    ]);
  });

  it('does not emit a phantom update when a downstream transaction step fails', async () => {
    const service = createService();
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a2');
    attachmentRepo.updateAttachmentsByPageId.mockRejectedValue(
      new Error('injected attachment update failure'),
    );

    await expect(service.movePageToSpace(rootPage, 'space-2')).rejects.toThrow(
      'injected attachment update failure',
    );

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('uses the transaction for reads and emits only after commit', async () => {
    const service = createService();
    const nextPosition = jest
      .spyOn(service, 'nextPagePosition')
      .mockResolvedValue('a2');

    await service.movePageToSpace(rootPage, 'space-2');

    expect(nextPosition).toHaveBeenCalledWith('space-2', undefined, trxStub);
    expect(pageRepo.findById).toHaveBeenCalledWith(rootPage.id, {
      withLock: true,
      trx: trxStub,
    });
    expect(pageRepo.getPageAndDescendants).toHaveBeenCalledWith(rootPage.id, {
      includeContent: false,
      includeDeleted: true,
      trx: trxStub,
    });
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      { spaceId: 'space-2', parentPageId: null, position: 'a2' },
      rootPage.id,
      trxStub,
      false,
    );
    expect(pageRepo.updatePages).toHaveBeenCalledWith(
      { spaceId: 'space-2' },
      [childPage.id],
      trxStub,
      false,
    );
    expect(sequence).toEqual([
      'transaction-start',
      'transaction-commit',
      'event',
    ]);
  });

  it('rejects a destination archived after the controller access check', async () => {
    const service = createService();
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a2');
    spaceQuery.execute.mockResolvedValue([
      { id: 'space-1', archivedAt: null },
      { id: 'space-2', archivedAt: new Date() },
    ]);

    await expect(service.movePageToSpace(rootPage, 'space-2')).rejects.toThrow(
      'Source or destination space not found',
    );

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
