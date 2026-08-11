import { DynamicModule, Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvironmentService } from '../environment/environment.service';
import { createRetryStrategy, parseRedisUrl } from '../../common/helpers';
import { QueueName } from './constants';
import { GeneralQueueProcessor } from './processors/general-queue.processor';
import { DuplicatePageAttachmentsService } from './services/duplicate-page-attachments.service';
import { QueueOutboxService } from './outbox/queue-outbox.service';
import { QueueOutboxBootstrapService } from './outbox/queue-outbox-bootstrap.service';
import { QueueOutboxHandlerRegistryService } from './outbox/queue-outbox-handler-registry.service';
import { QueueOutboxPersistenceModule } from '../../database/persistence/queue-outbox-persistence.module';

export interface QueueModuleOptions {
  registerGeneralWorker?: boolean;
}

@Global()
@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions = {}): DynamicModule {
    const registerWorker = options.registerGeneralWorker !== false;
    const workerProviders = registerWorker
      ? [
          DuplicatePageAttachmentsService,
          QueueOutboxHandlerRegistryService,
          QueueOutboxService,
          QueueOutboxBootstrapService,
          GeneralQueueProcessor,
        ]
      : [];

    return {
      module: QueueModule,
      imports: [
        QueueOutboxPersistenceModule,
        BullModule.forRootAsync({
          useFactory: (environmentService: EnvironmentService) => {
            const redisConfig = parseRedisUrl(environmentService.getRedisUrl());
            return {
              connection: {
                host: redisConfig.host,
                port: redisConfig.port,
                password: redisConfig.password,
                db: redisConfig.db,
                family: redisConfig.family,
                retryStrategy: createRetryStrategy(),
              },
              defaultJobOptions: {
                attempts: 3,
                backoff: {
                  type: 'exponential',
                  delay: 20 * 1000,
                },
                removeOnComplete: {
                  count: 200,
                },
                removeOnFail: {
                  count: 100,
                },
              },
            };
          },
          inject: [EnvironmentService],
        }),
        BullModule.registerQueue({
          name: QueueName.EMAIL_QUEUE,
        }),
        BullModule.registerQueue({
          name: QueueName.ATTACHMENT_QUEUE,
        }),
        BullModule.registerQueue({
          name: QueueName.GENERAL_QUEUE,
        }),
        BullModule.registerQueue({
          name: QueueName.FILE_TASK_QUEUE,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 1,
          },
        }),
        BullModule.registerQueue({
          name: QueueName.SEARCH_QUEUE,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 2,
          },
        }),
        BullModule.registerQueue({
          name: QueueName.AI_CHAT_QUEUE,
          defaultJobOptions: {
            removeOnComplete: {
              count: 200,
            },
            removeOnFail: {
              count: 200,
            },
            attempts: 1,
          },
        }),
        BullModule.registerQueue({
          name: QueueName.HISTORY_QUEUE,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 2,
          },
        }),
        BullModule.registerQueue({
          name: QueueName.NOTIFICATION_QUEUE,
        }),
      ],
      exports: [
        BullModule,
        ...(registerWorker
          ? [QueueOutboxService, QueueOutboxHandlerRegistryService]
          : []),
      ],
      providers: workerProviders,
    };
  }
}
