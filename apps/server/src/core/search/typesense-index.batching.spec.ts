import {
  TYPESENSE_DB_BATCH_SIZE,
  TYPESENSE_IMPORT_MAX_BYTES,
  TypesenseIndexService,
  partitionTypesenseDocuments,
} from './typesense-index.service';

describe('TypesenseIndexService bounded batching', () => {
  function createService(db: any = {}) {
    const environment = {
      getSearchDriver: jest.fn().mockReturnValue('typesense'),
      getTypesenseUrl: jest.fn().mockReturnValue('http://127.0.0.1:18108'),
      getTypesenseApiKey: jest.fn().mockReturnValue('synthetic-key'),
    } as any;
    const queue = { add: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new TypesenseIndexService(environment, db, queue);
    jest
      .spyOn(service as any, 'ensureCollections')
      .mockResolvedValue(undefined);
    return service;
  }

  it('partitions imports by document count and four MiB payload size', () => {
    const documents = Array.from({ length: 205 }, (_, index) => ({
      id: `document-${index}`,
      content: 'x'.repeat(16 * 1024),
    }));

    const batches = partitionTypesenseDocuments(documents);

    expect(batches.flat()).toEqual(documents);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(TYPESENSE_DB_BATCH_SIZE);
      expect(
        batch.reduce(
          (bytes, document) =>
            bytes + Buffer.byteLength(JSON.stringify(document), 'utf8') + 1,
          0,
        ),
      ).toBeLessThanOrEqual(TYPESENSE_IMPORT_MAX_BYTES);
    }
  });

  it('allows one oversized document only as its own import', () => {
    const oversized = {
      id: 'oversized',
      content: 'x'.repeat(TYPESENSE_IMPORT_MAX_BYTES + 1),
    };
    const small = { id: 'small', content: 'ok' };

    expect(partitionTypesenseDocuments([small, oversized, small])).toEqual([
      [small],
      [oversized],
      [small],
    ]);
  });

  it('reconciles thousands of ids in sequential database batches', async () => {
    const service = createService();
    let active = 0;
    let maxActive = 0;
    const reconcileBatch = jest
      .spyOn(service as any, 'reconcilePageBatch')
      .mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
      });
    const ids = Array.from({ length: 1_005 }, (_, index) => `page-${index}`);

    await service.reconcilePages(ids);

    expect(reconcileBatch).toHaveBeenCalledTimes(11);
    expect(maxActive).toBe(1);
    for (const call of reconcileBatch.mock.calls) {
      const batch = call[0] as string[];
      expect(batch.length).toBeLessThanOrEqual(TYPESENSE_DB_BATCH_SIZE);
    }
  });

  it('deletes inactive ids in sequential bounded filters', async () => {
    const service = createService();
    let active = 0;
    let maxActive = 0;
    const deleteByFilter = jest
      .spyOn(service as any, 'deleteByFilter')
      .mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
      });
    const ids = Array.from({ length: 250 }, (_, index) => `page-${index}`);

    await (service as any).deleteDocumentsByIds('pages', ids);

    expect(deleteByFilter).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    for (const call of deleteByFilter.mock.calls) {
      const filter = call[1] as string;
      expect((filter.match(/`/g) ?? []).length / 2).toBeLessThanOrEqual(
        TYPESENSE_DB_BATCH_SIZE,
      );
    }
  });

  it('imports batches sequentially', async () => {
    const service = createService();
    let active = 0;
    let maxActive = 0;
    const importDocuments = jest.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    });
    jest.spyOn(service as any, 'getClient').mockReturnValue({
      collections: () => ({
        documents: () => ({ import: importDocuments }),
      }),
    });
    const documents = Array.from({ length: 205 }, (_, index) => ({
      id: `document-${index}`,
    }));

    await (service as any).upsertDocuments('pages', documents);

    expect(importDocuments).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  });

  it('paginates attachments by cursor for a page batch', async () => {
    const rows = Array.from({ length: 225 }, (_, index) => ({
      id: `attachment-${String(index).padStart(4, '0')}`,
      workspaceId: 'workspace',
      spaceId: 'space',
      pageId: 'page',
      fileName: `attachment-${index}.txt`,
      textContent: 'content',
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    }));
    const resultBatches = [rows.slice(0, 100), rows.slice(100, 200), rows.slice(200)];
    const execute = jest.fn().mockImplementation(async () => resultBatches.shift());
    const query: any = {
      innerJoin: jest.fn(() => query),
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      execute,
    };
    const service = createService({ selectFrom: jest.fn(() => query) });
    const upsertAttachments = jest
      .spyOn(service as any, 'upsertAttachments')
      .mockResolvedValue(undefined);

    await (service as any).indexAttachmentsForPageIds(['page']);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(query.limit).toHaveBeenCalledWith(TYPESENSE_DB_BATCH_SIZE);
    expect(query.where).toHaveBeenCalledWith(
      'attachments.id',
      '>',
      'attachment-0099',
    );
    expect(query.where).toHaveBeenCalledWith(
      'attachments.id',
      '>',
      'attachment-0199',
    );
    expect(
      upsertAttachments.mock.calls.map(
        (call) => (call[0] as unknown[]).length,
      ),
    ).toEqual([100, 100, 25]);
  });

  it('destroys shared keep-alive agents during shutdown', async () => {
    const service = createService();
    const httpAgent = (service as any).httpAgent;
    const httpsAgent = (service as any).httpsAgent;
    const httpDestroy = jest.spyOn(httpAgent, 'destroy');
    const httpsDestroy = jest.spyOn(httpsAgent, 'destroy');

    expect(httpDestroy).not.toHaveBeenCalled();
    expect(httpsDestroy).not.toHaveBeenCalled();

    await service.onModuleDestroy();

    expect(httpDestroy).toHaveBeenCalledTimes(1);
    expect(httpsDestroy).toHaveBeenCalledTimes(1);
  });
});
