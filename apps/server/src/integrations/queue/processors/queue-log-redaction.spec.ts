import { NotificationProcessor } from '../../../core/notification/notification.processor';
import { AttachmentProcessor } from '../../../core/attachment/processors/attachment.processor';
import { HistoryProcessor } from '../../../collaboration/processors/history.processor';
import { EmailProcessor } from '../../mail/processors/email.processor';
import { FileTaskProcessor } from '../../import/processors/file-task.processor';
import { GeneralQueueProcessor } from './general-queue.processor';

jest.mock('../../import/services/file-import-task.service', () => ({
  FileImportTaskService: class FileImportTaskService {},
}));

describe('queue worker log redaction', () => {
  const failedJob = {
    name: 'synthetic-job',
    failedReason:
      'provider rejected recipient@example.test?token=queue-secret-canary',
  } as any;

  it.each([
    ['general', GeneralQueueProcessor.prototype.onError],
    ['notification', NotificationProcessor.prototype.onError],
    ['email', EmailProcessor.prototype.onError],
    ['attachment', AttachmentProcessor.prototype.onError],
    ['history', HistoryProcessor.prototype.onError],
  ])('%s worker omits raw BullMQ failure reasons', (_name, onError) => {
    const logger = { error: jest.fn() };

    onError.call({ logger } as any, failedJob);

    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).not.toContain('recipient@example.test');
    expect(serialized).not.toContain('queue-secret-canary');
  });

  it('file-task worker omits raw BullMQ failure reasons', async () => {
    const logger = { error: jest.fn() };
    const handleFailedJob = jest.fn();

    await FileTaskProcessor.prototype.onFailed.call(
      { logger, handleFailedJob } as any,
      { ...failedJob, data: { fileTaskId: 'task-1' } },
    );

    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).not.toContain('recipient@example.test');
    expect(serialized).not.toContain('queue-secret-canary');
  });
});
