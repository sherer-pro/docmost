jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { FileImportTaskService } from './file-import-task.service';
import { FileTaskStatus } from '../utils/file.utils';
import { readFileSync } from 'node:fs';

function createService() {
  const sequence: string[] = [];
  const update: any = {};
  for (const method of ['set', 'where']) update[method] = jest.fn(() => update);
  update.execute = jest.fn(async () => undefined);
  update.executeTakeFirst = jest.fn(async () => {
    sequence.push('task-updated');
    return { numUpdatedRows: 1n };
  });
  const db = { updateTable: jest.fn(() => update) };
  const storage = { delete: jest.fn(async () => undefined) };
  const service = new FileImportTaskService(
    storage as any,
    {} as any,
    {} as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, storage, db, sequence };
}

describe('FileImportTaskService durability', () => {
  const task = {
    id: '10000000-0000-4000-8000-000000000001',
    type: 'import',
    source: 'generic',
    status: FileTaskStatus.Pending,
    filePath: 'imports/task/archive.zip',
    attemptCount: 1,
  };

  it('fails closed when the task and its cascading artifact locator are missing', async () => {
    const { service } = createService();
    jest.spyOn(service, 'getFileTask').mockResolvedValue(undefined);

    await expect(
      service.processImportFromOutbox(task.id),
    ).rejects.toThrow('file_import_task_missing');
  });

  it('does not start a second worker while the durable task lease is live', async () => {
    const { service } = createService();
    jest.spyOn(service, 'getFileTask').mockResolvedValue(task as any);
    jest.spyOn(service as any, 'claimImportTask').mockResolvedValue(undefined);
    const process = jest.spyOn(service, 'processZIpImport');

    await expect(
      service.processImportFromOutbox(task.id),
    ).rejects.toThrow('file_import_claim_unavailable');
    expect(process).not.toHaveBeenCalled();
  });

  it('fences terminal failure before compensating orphan artifacts', async () => {
    const { service, sequence } = createService();
    jest
      .spyOn(service, 'getFileTask')
      .mockResolvedValueOnce(task as any)
      .mockResolvedValueOnce({
        ...task,
        status: FileTaskStatus.Processing,
      } as any);
    jest.spyOn(service as any, 'claimImportTask').mockResolvedValue({
      ...task,
      status: FileTaskStatus.Processing,
      attemptCount: 3,
    });
    jest.spyOn(service as any, 'startImportLeaseRenewal').mockReturnValue({
      isLost: () => false,
      stop: jest.fn(async () => undefined),
    });
    jest
      .spyOn(service, 'processZIpImport')
      .mockRejectedValue(new Error('page transaction failed'));
    const cleanup = jest
      .spyOn(service as any, 'cleanupOrphanImportArtifacts')
      .mockImplementation(async () => {
        sequence.push('cleanup');
      });

    await expect(
      service.processImportFromOutbox(task.id),
    ).resolves.toBeUndefined();

    expect(cleanup).toHaveBeenCalledWith(task.id);
    expect(sequence.slice(-2)).toEqual(['task-updated', 'cleanup']);
  });

  it('keeps the task failed when terminal storage compensation is unavailable', async () => {
    const { service, sequence } = createService();
    jest
      .spyOn(service, 'getFileTask')
      .mockResolvedValueOnce({ ...task, source: 'docmost' } as any)
      .mockResolvedValueOnce({
        ...task,
        source: 'docmost',
        status: FileTaskStatus.Processing,
      } as any);
    jest.spyOn(service as any, 'claimImportTask').mockResolvedValue({
      ...task,
      source: 'docmost',
      status: FileTaskStatus.Processing,
      attemptCount: 3,
    });
    jest.spyOn(service as any, 'startImportLeaseRenewal').mockReturnValue({
      isLost: () => false,
      stop: jest.fn(async () => undefined),
    });
    jest
      .spyOn(service, 'processZIpImport')
      .mockRejectedValue(new Error('only schema 5 is accepted'));
    jest
      .spyOn(service as any, 'cleanupOrphanImportArtifacts')
      .mockImplementation(async () => {
        sequence.push('cleanup-failed');
        throw new Error('storage unavailable');
      });

    await expect(
      service.processImportFromOutbox(task.id),
    ).resolves.toBeUndefined();

    expect(sequence).toEqual(['task-updated', 'cleanup-failed']);
  });

  it('does not clean an upload renewed before the atomic stale claim', async () => {
    const { service } = createService();
    jest.spyOn(service as any, 'claimStaleUploads').mockResolvedValue([]);
    const cleanup = jest.spyOn(
      service as any,
      'cleanupOrphanImportArtifacts',
    );

    await service.reconcileStaleUploads();

    expect(cleanup).not.toHaveBeenCalled();
    const source = readFileSync(
      __filename.replace(/\.durability\.spec\.ts$/, '.ts'),
      'utf8',
    );
    expect(source).toContain('for update skip locked');
    expect(source).toContain('and updated_at < ${cutoff}');
  });

  it('expires an unconfirmed Docmost preview before cleaning its durable artifact', async () => {
    const { service, sequence } = createService();
    jest
      .spyOn(service as any, 'claimStaleDocmostPreviews')
      .mockImplementation(async () => {
        sequence.push('preview-failed');
        return [{ id: task.id, filePath: task.filePath }];
      });
    jest
      .spyOn(service as any, 'cleanupOrphanImportArtifacts')
      .mockImplementation(async () => {
        sequence.push('cleanup');
      });

    await service.expireStaleDocmostPreviews();

    expect(sequence).toEqual(['preview-failed', 'cleanup']);
  });

  it('preserves a confirmed preview when confirmation wins the expiry CAS', async () => {
    const { service } = createService();
    jest
      .spyOn(service as any, 'claimStaleDocmostPreviews')
      .mockResolvedValue([]);
    const cleanup = jest.spyOn(
      service as any,
      'cleanupOrphanImportArtifacts',
    );

    await service.expireStaleDocmostPreviews();

    expect(cleanup).not.toHaveBeenCalled();
    const source = readFileSync(
      __filename.replace(/\.durability\.spec\.ts$/, '.ts'),
      'utf8',
    );
    expect(source).toContain('limit ${DOCMOST_PREVIEW_EXPIRY_BATCH_SIZE}');
    expect(source.match(/and task\.options is null/g)).toHaveLength(1);
    expect(source).toContain('and task.updated_at < ${cutoff}');
  });

  it('keeps an expired preview recoverable when immediate cleanup fails', async () => {
    const { service } = createService();
    jest
      .spyOn(service as any, 'claimStaleDocmostPreviews')
      .mockResolvedValue([{ id: task.id, filePath: task.filePath }]);
    jest
      .spyOn(service as any, 'cleanupOrphanImportArtifacts')
      .mockRejectedValue(new Error('storage unavailable'));

    await expect(service.expireStaleDocmostPreviews()).resolves.toBeUndefined();
  });
});
