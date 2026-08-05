import { Module } from '@nestjs/common';
import { AppController } from '../../app.controller';
import { AppService } from '../../app.service';
import { EnvironmentModule } from '../../integrations/environment/environment.module';
import { CollaborationModule } from '../collaboration.module';
import { DatabaseModule } from '@docmost/db/database.module';
import { QueueModule } from '../../integrations/queue/queue.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthModule } from '../../integrations/health/health.module';
import { CollaborationController } from './collaboration.controller';
import { LoggerModule } from '../../common/logger/logger.module';
import { RedisModule } from '@nestjs-labs/nestjs-ioredis';
import { RedisConfigService } from '../../integrations/redis/redis-config.service';
import { StorageModule } from '../../integrations/storage/storage.module';

@Module({
  imports: [
    LoggerModule,
    DatabaseModule,
    EnvironmentModule,
    CollaborationModule,
    QueueModule.forRoot({ registerGeneralWorker: false }),
    StorageModule.forRootAsync({
      imports: [EnvironmentModule],
    }),
    HealthModule,
    EventEmitterModule.forRoot(),
    RedisModule.forRootAsync({
      useClass: RedisConfigService,
    }),
  ],
  controllers: [AppController, CollaborationController],
  providers: [AppService],
})
export class CollabAppModule {}
