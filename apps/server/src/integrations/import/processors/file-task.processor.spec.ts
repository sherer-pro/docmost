jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { FileTaskProcessor } from './file-task.processor';

describe('FileTaskProcessor failure handling', () => {
  it('does not downgrade an import committed before a late worker failure', async () => {
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
    expect(storageService.delete).toHaveBeenCalledWith(
      'workspace/imports/task-1/archive.zip',
    );
  });
});
