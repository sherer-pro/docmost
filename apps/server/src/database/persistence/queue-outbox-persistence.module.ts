import { Module } from '@nestjs/common';
import { QueueOutboxRepo } from '../repos/queue-outbox/queue-outbox.repo';

@Module({
  providers: [QueueOutboxRepo],
  exports: [QueueOutboxRepo],
})
export class QueueOutboxPersistenceModule {}
