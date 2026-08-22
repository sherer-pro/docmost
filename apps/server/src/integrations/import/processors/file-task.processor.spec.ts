jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { FileTaskProcessor } from './file-task.processor';

describe('FileTaskProcessor failure handling', () => {
  it('fails closed for an unknown queue job', async () => {
    const processor = new FileTaskProcessor({} as any, {} as any);

    await expect(
      processor.process({ name: 'retired-import-job', data: {} } as any),
    ).rejects.toThrow('unknown_file_task_queue_job');
  });

  it('does not mutate an import from an unfenced late Bull failure', async () => {
    const fileTaskService = {
      getFileTask: jest.fn(async () => ({
        id: 'task-1',
        status: 'success',
        filePath: 'workspace/imports/task-1/archive.zip',
      })),
      updateTaskStatus: jest.fn(async () => undefined),
    };
    const storageService = {
      delete: jest.fn(async () => undefined),
    };
    const processor = new FileTaskProcessor(
      fileTaskService as any,
      storageService as any,
    );

    await processor.onFailed({
      name: 'import-task',
      data: { fileTaskId: 'task-1' },
    } as any);

    expect(fileTaskService.updateTaskStatus).not.toHaveBeenCalled();
    expect(storageService.delete).not.toHaveBeenCalled();
  });

  it('delegates a legacy Docmost rejection to the fenced durable handler', async () => {
    const fileTaskService = {
      processImportFromOutbox: jest.fn(async () => {
        throw new Error(
          'Docmost archive schema 4 is not supported; only schema 5 is accepted',
        );
      }),
      getFileTask: jest.fn(async () => ({
        id: 'task-legacy-v4',
        source: 'docmost',
        status: 'processing',
        filePath: 'workspace/imports/task-legacy-v4/archive.zip',
      })),
      updateTaskStatus: jest.fn(async () => undefined),
    };
    const storageService = {
      delete: jest.fn(async () => undefined),
    };
    const processor = new FileTaskProcessor(
      fileTaskService as any,
      storageService as any,
    );
    const job = {
      name: 'import-task',
      data: { fileTaskId: 'task-legacy-v4' },
    } as any;

    await expect(processor.process(job)).rejects.toThrow(
      'only schema 5 is accepted',
    );
    await processor.onFailed(job);

    expect(fileTaskService.processImportFromOutbox).toHaveBeenCalledWith(
      'task-legacy-v4',
    );
    expect(fileTaskService.updateTaskStatus).not.toHaveBeenCalled();
    expect(storageService.delete).not.toHaveBeenCalled();
  });
});
