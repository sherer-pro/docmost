jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { Readable } from 'node:stream';
import { ImportService } from './import.service';
import { FileImportSource, FileTaskStatus } from '../utils/file.utils';

function mutation(result: unknown) {
  const query: any = {};
  for (const method of ['values', 'set', 'where', 'returning', 'returningAll']) {
    query[method] = jest.fn(() => query);
  }
  query.execute = jest.fn(async () => result);
  query.executeTakeFirst = jest.fn(async () => result);
  query.executeTakeFirstOrThrow = jest.fn(async () => result);
  return query;
}

describe('ImportService durable ZIP admission', () => {
  function harness(uploadError?: Error) {
    const sequence: string[] = [];
    const uploadingTask = {
      id: '10000000-0000-4000-8000-000000000001',
      status: FileTaskStatus.Uploading,
      filePath: 'imports/archive.zip',
    };
    const pendingTask = { ...uploadingTask, status: FileTaskStatus.Pending };
    const initialInsert = mutation(uploadingTask);
    initialInsert.executeTakeFirstOrThrow.mockImplementation(async () => {
      sequence.push('task-uploading');
      return uploadingTask;
    });
    const artifactInsert = mutation(undefined);
    artifactInsert.execute.mockImplementation(async () => {
      sequence.push('artifact-locator');
    });
    const pendingUpdate = mutation(pendingTask);
    pendingUpdate.executeTakeFirst.mockImplementation(async () => {
      sequence.push('task-pending');
      return pendingTask;
    });
    const artifactUpdate = mutation(undefined);
    artifactUpdate.execute.mockImplementation(async () => {
      const value = artifactUpdate.set.mock.calls.at(-1)?.[0];
      sequence.push(
        value?.status === 'cleaned'
          ? 'artifact-cleaned'
          : value?.completedAt === null
            ? 'artifact-reopened'
            : 'artifact-uploaded',
      );
    });
    const failedUpdate = mutation({ numUpdatedRows: 1n });
    failedUpdate.executeTakeFirst.mockImplementation(async () => {
      sequence.push('task-failed');
      return { numUpdatedRows: 1n };
    });
    const trx = {
      insertInto: jest.fn((table: string) =>
        table === 'fileTasks' ? initialInsert : artifactInsert,
      ),
      updateTable: jest.fn((table: string) =>
        table === 'fileTasks' ? pendingUpdate : artifactUpdate,
      ),
    };
    const db: any = {
      updateTable: jest.fn((table: string) =>
        table === 'fileTasks' ? failedUpdate : artifactUpdate,
      ),
      transaction: jest.fn(() => ({
        execute: async (callback: (value: any) => Promise<unknown>) => {
          sequence.push('transaction-start');
          const result = await callback(trx);
          sequence.push('transaction-commit');
          return result;
        },
      })),
    };
    const storage = {
      upload: jest.fn(async (_path: string, stream: Readable) => {
        sequence.push('upload');
        for await (const _chunk of stream) {
          // Consume the stream so the byte-counting transform is authoritative.
        }
        if (uploadError) throw uploadError;
      }),
      delete: jest.fn(async () => {
        sequence.push('storage-cleanup');
      }),
    };
    const outbox = {
      enqueueFileImport: jest.fn(async () => {
        sequence.push('outbox-intent');
      }),
      kick: jest.fn(() => sequence.push('outbox-kick')),
    };
    const service = new ImportService(
      {} as any,
      storage as any,
      db as any,
      outbox as any,
    );
    const file = {
      filename: 'archive.zip',
      file: Readable.from(Buffer.from('zip-content')),
    };
    return {
      service,
      file,
      sequence,
      outbox,
      storage,
      failedUpdate,
      artifactUpdate,
      trx,
      db,
    };
  }

  it('persists uploading before storage and commits pending with its outbox intent', async () => {
    const { service, file, sequence, outbox, trx } = harness();

    await service.importZip(
      Promise.resolve(file as any),
      FileImportSource.Generic,
      'user-1',
      'space-1',
      'workspace-1',
    );

    expect(sequence).toEqual([
      'transaction-start',
      'task-uploading',
      'artifact-locator',
      'transaction-commit',
      'upload',
      'transaction-start',
      'task-pending',
      'artifact-uploaded',
      'outbox-intent',
      'transaction-commit',
      'outbox-kick',
    ]);
    expect(outbox.enqueueFileImport).toHaveBeenCalledWith(
      expect.any(String),
      trx,
    );
  });

  it('records upload failure before compensating the ambiguous storage path', async () => {
    const { service, file, sequence, failedUpdate, storage } = harness(
      new Error('upload failed'),
    );

    await expect(
      service.importZip(
        Promise.resolve(file as any),
        FileImportSource.Notion,
        'user-1',
        'space-1',
        'workspace-1',
      ),
    ).rejects.toThrow('upload failed');

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(failedUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: FileTaskStatus.Failed }),
    );
    expect(sequence).toEqual([
      'transaction-start',
      'task-uploading',
      'artifact-locator',
      'transaction-commit',
      'upload',
      'task-failed',
      'artifact-reopened',
      'storage-cleanup',
      'artifact-cleaned',
    ]);
  });

  it('removes a late upload after the stale reconciler already cleaned its locator', async () => {
    const {
      service,
      file,
      sequence,
      storage,
      failedUpdate,
      artifactUpdate,
      db,
    } = harness();
    let objectPresent = false;
    storage.upload.mockImplementation(async (_path: string, stream: Readable) => {
      sequence.push('upload-start');
      for await (const _chunk of stream) {
        // Keep the upload completion ordered after the simulated reconciler.
      }
      sequence.push('reconciler-failed');
      sequence.push('reconciler-cleaned');
      objectPresent = true;
      sequence.push('upload-completed');
    });
    storage.delete.mockImplementation(async () => {
      sequence.push('late-upload-cleanup');
      objectPresent = false;
    });
    failedUpdate.executeTakeFirst.mockImplementation(async () => {
      sequence.push('own-failure-cas-missed');
      return { numUpdatedRows: 0n };
    });
    const currentTaskQuery: any = {};
    currentTaskQuery.select = jest.fn(() => currentTaskQuery);
    currentTaskQuery.where = jest.fn(() => currentTaskQuery);
    currentTaskQuery.executeTakeFirst = jest.fn(async () => ({
      status: FileTaskStatus.Failed,
    }));
    db.selectFrom = jest.fn(() => currentTaskQuery);
    jest.spyOn(service as any, 'startFileUploadLeaseRenewal').mockReturnValue({
      isLost: () => true,
      stop: jest.fn(async () => undefined),
    });

    await expect(
      service.importZip(
        Promise.resolve(file as any),
        FileImportSource.Generic,
        'user-1',
        'space-1',
        'workspace-1',
      ),
    ).rejects.toThrow('file_task_upload_lease_lost');

    expect(objectPresent).toBe(false);
    expect(artifactUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'uploaded', completedAt: null }),
    );
    expect(sequence.indexOf('reconciler-cleaned')).toBeLessThan(
      sequence.indexOf('upload-completed'),
    );
    expect(sequence.indexOf('upload-completed')).toBeLessThan(
      sequence.indexOf('artifact-reopened'),
    );
    expect(sequence.indexOf('artifact-reopened')).toBeLessThan(
      sequence.indexOf('late-upload-cleanup'),
    );
    expect(sequence.at(-1)).toBe('artifact-cleaned');
  });

  it('confirms Docmost import by atomically persisting options and its outbox intent', async () => {
    const updated = {
      id: 'task-1',
      source: 'docmost',
      status: FileTaskStatus.Pending,
      options: { applyTags: false },
    };
    const update = mutation(updated);
    const trx = { updateTable: jest.fn(() => update) };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (value: any) => Promise<unknown>) => callback(trx),
      })),
    };
    const outbox = {
      enqueueFileImport: jest.fn(async () => undefined),
      kick: jest.fn(),
    };
    const service = new ImportService(
      {} as any,
      {} as any,
      db as any,
      outbox as any,
    );
    jest
      .spyOn(service as any, 'getPendingDocmostImportTask')
      .mockResolvedValue(updated);

    await expect(
      service.confirmDocmostImport(
        'task-1',
        {
          applyDocumentFields: false,
          applyDictionary: false,
          applyHeadingNumbering: false,
          applyTags: false,
          cleanupLegacyHeadingNumbers: true,
        },
        'user-1',
        'workspace-1',
      ),
    ).resolves.toEqual(updated);

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: FileTaskStatus.Pending }),
    );
    expect(update.where).toHaveBeenCalledWith('options', 'is', null);
    expect(outbox.enqueueFileImport).toHaveBeenCalledWith('task-1', trx);
    expect(outbox.kick).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue when preview expiry wins after confirmation preflight', async () => {
    const update = mutation(undefined);
    const trx = { updateTable: jest.fn(() => update) };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (value: any) => Promise<unknown>) => callback(trx),
      })),
    };
    const outbox = {
      enqueueFileImport: jest.fn(),
      kick: jest.fn(),
    };
    const service = new ImportService(
      {} as any,
      {} as any,
      db as any,
      outbox as any,
    );
    jest.spyOn(service as any, 'getPendingDocmostImportTask').mockResolvedValue({
      id: 'task-1',
      source: 'docmost',
      status: FileTaskStatus.Pending,
      options: null,
    });

    await expect(
      service.confirmDocmostImport(
        'task-1',
        {
          applyDocumentFields: false,
          applyDictionary: false,
          applyHeadingNumbering: false,
          applyTags: false,
          cleanupLegacyHeadingNumbers: true,
        },
        'user-1',
        'workspace-1',
      ),
    ).rejects.toThrow('Import task state changed');

    expect(update.where).toHaveBeenCalledWith(
      'status',
      '=',
      FileTaskStatus.Pending,
    );
    expect(update.where).toHaveBeenCalledWith('options', 'is', null);
    expect(outbox.enqueueFileImport).not.toHaveBeenCalled();
    expect(outbox.kick).not.toHaveBeenCalled();
  });

  it('does not let cancellation delete an archive after confirmation wins the CAS', async () => {
    const cancel = mutation(undefined);
    const existingQuery: any = {};
    existingQuery.select = jest.fn(() => existingQuery);
    existingQuery.where = jest.fn(() => existingQuery);
    existingQuery.executeTakeFirst = jest.fn(async () => ({
      source: 'docmost',
      creatorId: 'user-1',
      workspaceId: 'workspace-1',
    }));
    const storage = { delete: jest.fn() };
    const db = {
      updateTable: jest.fn(() => cancel),
      selectFrom: jest.fn(() => existingQuery),
    };
    const service = new ImportService(
      {} as any,
      storage as any,
      db as any,
      {} as any,
    );

    await expect(
      service.cancelDocmostImport('task-1', 'user-1', 'workspace-1'),
    ).rejects.toThrow('Only an unconfirmed pending import can be cancelled');

    expect(cancel.where).toHaveBeenCalledWith('status', '=', 'pending');
    expect(cancel.where).toHaveBeenCalledWith('options', 'is', null);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('persists cancellation before best-effort archive cleanup', async () => {
    const sequence: string[] = [];
    const cancelled = mutation({ id: 'task-1', filePath: 'imports/task.zip' });
    cancelled.executeTakeFirst.mockImplementation(async () => {
      sequence.push('task-failed');
      return { id: 'task-1', filePath: 'imports/task.zip' };
    });
    const storage = {
      delete: jest.fn(async () => {
        sequence.push('cleanup-failed');
        throw new Error('storage unavailable');
      }),
    };
    const service = new ImportService(
      {} as any,
      storage as any,
      { updateTable: jest.fn(() => cancelled) } as any,
      {} as any,
    );

    await expect(
      service.cancelDocmostImport('task-1', 'user-1', 'workspace-1'),
    ).resolves.toBeUndefined();

    expect(cancelled.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: FileTaskStatus.Failed,
        errorMessage: 'file_task_cancelled',
      }),
    );
    expect(sequence).toEqual(['task-failed', 'cleanup-failed']);
  });
});
