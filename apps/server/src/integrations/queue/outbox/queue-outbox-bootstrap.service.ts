import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DatabaseReadinessService } from '@docmost/db/services/database-readiness.service';
import { QueueOutboxService } from './queue-outbox.service';

@Injectable()
export class QueueOutboxBootstrapService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(QueueOutboxBootstrapService.name);
  private retryTimer?: NodeJS.Timeout;
  private destroyed = false;

  constructor(
    private readonly databaseReadiness: DatabaseReadinessService,
    private readonly queueOutbox: QueueOutboxService,
  ) {}

  onApplicationBootstrap(): void {
    void this.startAfterDatabaseReady();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private async startAfterDatabaseReady(): Promise<void> {
    await this.databaseReadiness.waitUntilReady();
    if (this.destroyed) return;
    await this.scheduleWithRetry();
  }

  private async scheduleWithRetry(): Promise<void> {
    try {
      await this.queueOutbox.ensurePeriodicSweep();
      this.queueOutbox.kick();
    } catch {
      this.logger.warn(
        'Failed to register the periodic outbox sweep; retrying in 15 seconds',
      );
      if (!this.destroyed) {
        this.retryTimer = setTimeout(() => {
          void this.scheduleWithRetry();
        }, 15_000);
      }
    }
  }
}
