jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { PageService } from './page.service';

const ROOT_PAGE_ID = '10000000-0000-4000-8000-000000000001';
const TEMPLATE_PAGE_ID = '10000000-0000-4000-8000-000000000002';

function chain(execute: () => unknown, executeTakeFirst?: () => unknown) {
  const query: any = {};
  for (const method of [
    'selectFrom',
    'select',
    'where',
    'orderBy',
    'limit',
    'forUpdate',
    'set',
  ]) {
    query[method] = jest.fn(() => query);
  }
  query.execute = jest.fn(execute);
  query.executeTakeFirst = jest.fn(executeTakeFirst ?? execute);
  return query;
}

describe('PageService template subtree deletion guard', () => {
  const pageRepo = { removePage: jest.fn() };
  const attachmentQueue = { add: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  let activeInstance: { id: string } | undefined;
  let sequence: string[];
  let releasePageLocks: (() => void) | undefined;
  let waitForPageLocks = false;
  let pageLocksStarted: Promise<void>;
  let resolvePageLocksStarted: () => void;
  let descendantsQuery: any;
  let pageLockQuery: any;
  let activeInstanceQuery: any;
  let pageUpdateQuery: any;
  let pageDeleteQuery: any;
  let shareDeleteQuery: any;
  let trx: any;
  let db: any;
  let service: PageService;

  beforeEach(() => {
    jest.clearAllMocks();
    activeInstance = { id: 'active-instance' };
    sequence = [];
    waitForPageLocks = false;
    pageLocksStarted = new Promise<void>((resolve) => {
      resolvePageLocksStarted = resolve;
    });
    descendantsQuery = chain(async () => [
      { id: ROOT_PAGE_ID },
      { id: TEMPLATE_PAGE_ID },
    ]);
    pageLockQuery = chain(async () => {
      sequence.push('page-lock');
      resolvePageLocksStarted();
      if (waitForPageLocks) {
        await new Promise<void>((resolve) => {
          releasePageLocks = resolve;
        });
      }
      return [
        { id: ROOT_PAGE_ID, templateKind: null },
        { id: TEMPLATE_PAGE_ID, templateKind: 'synced' },
      ];
    });
    activeInstanceQuery = chain(
      async () => [],
      async () => {
        sequence.push('active-instance-check');
        return activeInstance;
      },
    );
    pageUpdateQuery = chain(async () => {
      sequence.push('soft-delete');
      return [];
    });
    pageDeleteQuery = chain(async () => {
      sequence.push('hard-delete');
      return [];
    });
    shareDeleteQuery = chain(async () => {
      sequence.push('share-delete');
      return [];
    });
    trx = {
      withRecursive: jest.fn(() => descendantsQuery),
      selectFrom: jest.fn((table: string) =>
        table === 'pages' ? pageLockQuery : activeInstanceQuery,
      ),
      updateTable: jest.fn(() => pageUpdateQuery),
      deleteFrom: jest.fn((table: string) =>
        table === 'pages' ? pageDeleteQuery : shareDeleteQuery,
      ),
    };
    db = {
      transaction: jest.fn(() => ({
        execute: async (callback: (transaction: any) => Promise<unknown>) => {
          sequence.push('transaction-start');
          const result = await callback(trx);
          sequence.push('transaction-commit');
          return result;
        },
      })),
    };
    attachmentQueue.add.mockImplementation(async () => {
      sequence.push('attachment-job');
    });
    service = new PageService(
      pageRepo as any,
      {} as any,
      db as any,
      {} as any,
      attachmentQueue as any,
      {} as any,
      {} as any,
      eventEmitter as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it.each([
    {
      label: 'soft delete',
      execute: () => service.removePage(ROOT_PAGE_ID, 'user-1', 'workspace-1'),
    },
    {
      label: 'hard delete',
      execute: () => service.forceDelete(ROOT_PAGE_ID, 'workspace-1'),
    },
  ])(
    'blocks $label when a descendant template has active instances',
    async ({ execute }) => {
      await expect(execute()).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'page_template_has_active_instances',
        }),
      });

      expect(trx.withRecursive).toHaveBeenCalledWith(
        'page_descendants',
        expect.any(Function),
      );
      expect(pageLockQuery.forUpdate).toHaveBeenCalledTimes(1);
      expect(sequence).toEqual([
        'transaction-start',
        'page-lock',
        'active-instance-check',
      ]);
      expect(pageUpdateQuery.execute).not.toHaveBeenCalled();
      expect(pageDeleteQuery.execute).not.toHaveBeenCalled();
      expect(attachmentQueue.add).not.toHaveBeenCalled();
    },
  );

  it('rechecks active instances after waiting on the template source lock', async () => {
    waitForPageLocks = true;
    activeInstance = undefined;
    const deletion = service.removePage(ROOT_PAGE_ID, 'user-1', 'workspace-1');

    await pageLocksStarted;
    expect(activeInstanceQuery.executeTakeFirst).not.toHaveBeenCalled();

    // Simulate createFromTemplate committing its instance before releasing the
    // same source-page row lock that deletion is waiting for.
    activeInstance = { id: 'concurrent-instance' };
    releasePageLocks!();

    await expect(deletion).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'page_template_has_active_instances',
      }),
    });
    expect(sequence).toEqual([
      'transaction-start',
      'page-lock',
      'active-instance-check',
    ]);
  });

  it('commits a hard delete before scheduling attachment removal', async () => {
    activeInstance = undefined;

    await service.forceDelete(ROOT_PAGE_ID, 'workspace-1');

    expect(sequence).toEqual([
      'transaction-start',
      'page-lock',
      'active-instance-check',
      'hard-delete',
      'transaction-commit',
      'attachment-job',
      'attachment-job',
    ]);
    expect(eventEmitter.emit).toHaveBeenCalledWith('page.deleted', {
      pageIds: [ROOT_PAGE_ID, TEMPLATE_PAGE_ID],
      workspaceId: 'workspace-1',
    });
  });
});
