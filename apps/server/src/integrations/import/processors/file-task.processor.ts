import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../../queue/constants';
import { FileImportTaskService } from '../services/file-import-task.service';
import { FileTaskStatus } from '../utils/file.utils';
import { StorageService } from '../../storage/storage.service';

@Processor(QueueName.FILE_TASK_QUEUE)
export class FileTaskProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(FileTaskProcessor.name);

  constructor(
    private readonly fileTaskService: FileImportTaskService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<any, void>): Promise<void> {
    try {
      switch (job.name) {
        case QueueJob.IMPORT_TASK:
          await this.fileTaskService.processZIpImport(job.data.fileTaskId);
          break;
        case QueueJob.EXPORT_TASK:
          // TODO: export task
          break;
      }
    } catch (err) {
      this.logger.error({
        event: 'file_task_processing_failed',
        jobName: job.name,
      });
      throw err;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job) {
    this.logger.error({
      event: 'file_task_queue_job_failed',
      jobName: job.name,
    });

    await this.handleFailedJob(job);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    this.logger.log(`Completed ${job.name} job`);

    try {
      const fileTask = await this.fileTaskService.getFileTask(
        job.data.fileTaskId,
      );
      if (fileTask) {
        await this.storageService.delete(fileTask.filePath);
        this.logger.debug('Deleted imported zip file');
      }
    } catch {
      this.logger.error('Failed to delete imported zip file');
    }
  }

  private async handleFailedJob(job: Job) {
    try {
      const fileTaskId = job.data.fileTaskId;
      await this.fileTaskService.updateTaskStatus(
        fileTaskId,
        FileTaskStatus.Failed,
        'file_task_processing_failed',
      );

      const fileTask = await this.fileTaskService.getFileTask(fileTaskId);
      if (fileTask) {
        await this.storageService.delete(fileTask.filePath);
      }
    } catch {
      this.logger.error('Failed to persist file task failure state');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
