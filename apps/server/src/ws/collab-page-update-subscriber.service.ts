import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { validate as isUuid } from 'uuid';
import {
  COLLAB_PAGE_UPDATE_PROCESS_ID,
  COLLAB_PAGE_UPDATE_REDIS_CHANNEL,
  CollabPageUpdateMessage,
} from '../common/events/collab-page-update-channel';
import { EventName } from '../common/events/event.contants';

const MAX_PAGE_IDS_PER_MESSAGE = 100;

@Injectable()
export class CollabPageUpdateSubscriberService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    CollabPageUpdateSubscriberService.name,
  );
  private subscriber: Redis | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    try {
      this.subscriber = this.redisService.getOrThrow().duplicate();
      this.subscriber.on('message', this.handleMessage);
      this.subscriber.on('error', this.handleError);
      void this.subscriber
        .subscribe(COLLAB_PAGE_UPDATE_REDIS_CHANNEL)
        .catch(() => {
          this.logger.warn('Collaboration page update subscription failed');
        });
    } catch {
      this.logger.warn('Collaboration page update channel unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    this.subscriber.removeListener('message', this.handleMessage);
    this.subscriber.removeListener('error', this.handleError);
    await this.subscriber.quit().catch(() => undefined);
    this.subscriber = null;
  }

  private readonly handleMessage = (channel: string, raw: string): void => {
    if (channel !== COLLAB_PAGE_UPDATE_REDIS_CHANNEL) return;
    const message = this.parseMessage(raw);
    if (!message || message.origin === COLLAB_PAGE_UPDATE_PROCESS_ID) return;

    void this.eventEmitter
      .emitAsync(EventName.PAGE_UPDATED, {
        pageIds: message.pageIds,
        workspaceId: message.workspaceId,
      })
      .catch(() => {
        this.logger.warn('Collaboration page update dispatch failed');
      });
  };

  private readonly handleError = (): void => {
    this.logger.warn('Collaboration page update channel interrupted');
  };

  private parseMessage(raw: string): CollabPageUpdateMessage | null {
    try {
      const message = JSON.parse(raw) as Partial<CollabPageUpdateMessage>;
      if (
        message.version !== 1 ||
        typeof message.origin !== 'string' ||
        !isUuid(message.origin) ||
        typeof message.workspaceId !== 'string' ||
        !isUuid(message.workspaceId) ||
        !Array.isArray(message.pageIds) ||
        message.pageIds.length === 0 ||
        message.pageIds.length > MAX_PAGE_IDS_PER_MESSAGE ||
        message.pageIds.some((pageId) => !isUuid(pageId))
      ) {
        return null;
      }
      return {
        version: 1,
        origin: message.origin,
        workspaceId: message.workspaceId,
        pageIds: Array.from(new Set(message.pageIds)),
      };
    } catch {
      return null;
    }
  }
}
