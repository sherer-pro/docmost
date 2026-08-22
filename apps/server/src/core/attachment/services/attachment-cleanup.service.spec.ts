import { AttachmentCleanupService } from './attachment-cleanup.service';

function query(result: unknown) {
  const chain: any = {};
  for (const method of [
    'select',
    'where',
    'orderBy',
    'limit',
    'set',
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.execute = jest.fn(async () => result);
  chain.executeTakeFirst = jest.fn(async () => result);
  chain.executeTakeFirstOrThrow = jest.fn(async () => result);
  return chain;
}

describe('AttachmentCleanupService', () => {
  function harness(opts?: { failPath?: string }) {
    const batchQuery = query({ id: 'batch-1', status: 'pending' });
    const countsQuery = query({ total: 2, completed: opts?.failPath ? 1 : 2, failed: opts?.failPath ? 1 : 0 });
    const updateQueries: any[] = [];
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(batchQuery)
        .mockReturnValueOnce(countsQuery),
      updateTable: jest.fn(() => {
        const update = query({ numUpdatedRows: 1n });
        updateQueries.push(update);
        return update;
      }),
    };
    const storage = {
      delete: jest.fn(async (filePath: string) => {
        if (filePath === opts?.failPath) throw new Error('storage unavailable');
      }),
    };
    const service = new AttachmentCleanupService(db as any, storage as any);
    jest
      .spyOn(service as any, 'claimItems')
      .mockResolvedValueOnce([
        { id: 'item-1', filePath: 'files/a' },
        { id: 'item-2', filePath: 'files/b' },
      ])
      .mockResolvedValueOnce([]);
    return { service, storage, updateQueries };
  }

  it('deletes a bounded claimed batch and marks every item complete', async () => {
    const { service, storage } = harness();

    await expect(
      service.processCleanupBatchFromOutbox('batch-1'),
    ).resolves.toBeUndefined();

    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith('files/a');
    expect(storage.delete).toHaveBeenCalledWith('files/b');
  });

  it('persists a partial failure and rejects so the outbox retries it', async () => {
    const { service, storage } = harness({ failPath: 'files/b' });

    await expect(
      service.processCleanupBatchFromOutbox('batch-1'),
    ).rejects.toThrow('attachment_cleanup_batch_incomplete');

    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('retries only the failed durable item and converges on the next outbox attempt', async () => {
    const firstBatch = query({ id: 'batch-retry', status: 'pending' });
    const firstCounts = query({ total: 2, completed: 1, failed: 1 });
    const retryBatch = query({ id: 'batch-retry', status: 'failed' });
    const retryCounts = query({ total: 2, completed: 2, failed: 0 });
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(firstBatch)
        .mockReturnValueOnce(firstCounts)
        .mockReturnValueOnce(retryBatch)
        .mockReturnValueOnce(retryCounts),
      updateTable: jest.fn(() => query({ numUpdatedRows: 1n })),
    };
    let failedOnce = false;
    const storage = {
      delete: jest.fn(async (filePath: string) => {
        if (filePath === 'files/b' && !failedOnce) {
          failedOnce = true;
          throw new Error('storage unavailable');
        }
      }),
    };
    const service = new AttachmentCleanupService(db as any, storage as any);
    jest
      .spyOn(service as any, 'claimItems')
      .mockResolvedValueOnce([
        { id: 'item-a', filePath: 'files/a' },
        { id: 'item-b', filePath: 'files/b' },
      ])
      .mockResolvedValueOnce([{ id: 'item-b', filePath: 'files/b' }]);

    await expect(
      service.processCleanupBatchFromOutbox('batch-retry'),
    ).rejects.toThrow('attachment_cleanup_batch_incomplete');
    await expect(
      service.processCleanupBatchFromOutbox('batch-retry'),
    ).resolves.toBeUndefined();

    expect(storage.delete).toHaveBeenCalledTimes(3);
    expect(storage.delete.mock.calls).toEqual([
      ['files/a'],
      ['files/b'],
      ['files/b'],
    ]);
  });

  it('continues a batch beyond one bounded dispatch without spending an outbox retry', async () => {
    const firstBatch = query({ id: 'batch-large', status: 'pending' });
    const firstCounts = query({ total: 1050, completed: 1000, failed: 0 });
    const secondBatch = query({ id: 'batch-large', status: 'pending' });
    const secondCounts = query({ total: 1050, completed: 1050, failed: 0 });
    const updates: any[] = [];
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(firstBatch)
        .mockReturnValueOnce(firstCounts)
        .mockReturnValueOnce(secondBatch)
        .mockReturnValueOnce(secondCounts),
      updateTable: jest.fn(() => {
        const update = query({ numUpdatedRows: 1n });
        updates.push(update);
        return update;
      }),
    };
    const storage = { delete: jest.fn(async () => undefined) };
    const service = new AttachmentCleanupService(db as any, storage as any);
    const pages = Array.from({ length: 21 }, (_, page) =>
      Array.from({ length: 50 }, (_, item) => ({
        id: `item-${page}-${item}`,
        filePath: `files/${page}/${item}`,
      })),
    );
    const claim = jest.spyOn(service as any, 'claimItems');
    for (const page of pages) claim.mockResolvedValueOnce(page);
    claim.mockResolvedValueOnce([]);

    await expect(
      service.processCleanupBatchFromOutbox('batch-large'),
    ).resolves.toBeUndefined();
    await expect(
      service.processCleanupBatchFromOutbox('batch-large'),
    ).resolves.toBeUndefined();

    expect(storage.delete).toHaveBeenCalledTimes(1050);
    expect(
      updates.some((update) =>
        update.set.mock.calls.some(
          ([value]: [Record<string, unknown>]) => value.status === 'pending',
        ),
      ),
    ).toBe(true);
    expect(
      updates.some((update) =>
        update.set.mock.calls.some(
          ([value]: [Record<string, unknown>]) => value.status === 'completed',
        ),
      ),
    ).toBe(true);
  });

  it('reclaims an expired processing continuation after a worker crash', async () => {
    const expired = query([{ id: 'batch-crashed' }]);
    const predicates: unknown[][] = [];
    const eb: any = (...args: unknown[]) => {
      predicates.push(args);
      return args;
    };
    eb.or = (values: unknown[]) => values;
    eb.and = (values: unknown[]) => values;
    expired.where.mockImplementation((value: unknown) => {
      if (typeof value === 'function') value(eb);
      return expired;
    });
    const service = new AttachmentCleanupService(
      { selectFrom: jest.fn(() => expired) } as any,
      {} as any,
    );
    const process = jest
      .spyOn(service, 'processCleanupBatchFromOutbox')
      .mockResolvedValue(undefined);

    await service.continuePendingBatches();

    expect(predicates).toContainEqual(['status', '=', 'processing']);
    expect(predicates).toContainEqual([
      'leaseExpiresAt',
      '<=',
      expect.any(Date),
    ]);
    expect(process).toHaveBeenCalledWith('batch-crashed');
  });
});
