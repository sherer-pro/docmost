import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { validate as isUuid } from 'uuid';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { AiFileService } from './services/ai-file.service';
import { AiRunExecutionService } from './services/ai-run-execution.service';
import { AiAuxRunExecutionService } from './services/ai-aux-run-execution.service';

@Processor(QueueName.AI_CHAT_QUEUE, { concurrency: 8 })
export class AiChatProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly runs: AiRunExecutionService,
    private readonly auxRuns: AiAuxRunExecutionService,
    private readonly files: AiFileService,
    @InjectQueue(QueueName.AI_CHAT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === QueueJob.AI_CHAT_RUN) {
      const runId = this.requireUuid(job.data?.runId, 'runId');
      await this.runs.execute(runId);
      return;
    }
    if (job.name === QueueJob.AI_AUX_RUN) {
      const runId = this.requireUuid(job.data?.runId, 'runId');
      await this.auxRuns.execute(runId);
      return;
    }
    if (job.name === QueueJob.AI_CHAT_FILE_EXTRACT) {
      const fileId = this.requireUuid(job.data?.fileId, 'fileId');
      await this.files.extract(fileId);
      return;
    }
    if (job.name === QueueJob.AI_CHAT_RETENTION_CLEANUP) {
      await this.files.cleanupRetention();
      return;
    }
    throw new Error(`Unknown AI chat job: ${job.name}`);
  }

  async onModuleInit() {
    await this.queue.add(
      QueueJob.AI_CHAT_RETENTION_CLEANUP,
      {},
      {
        jobId: 'ai-chat-retention-cleanup',
        repeat: { every: 60 * 60 * 1000 },
        attempts: 1,
      },
    );
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.close();
  }

  private requireUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new Error(`Invalid AI chat job ${field}`);
    }
    return value;
  }
}
