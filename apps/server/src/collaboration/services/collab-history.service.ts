import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { IPageHistoryEventFlushJob } from '../../integrations/queue/constants/queue.interface';
import {
  HISTORY_EVENT_AGGREGATION_WINDOW,
  HISTORY_EVENT_BUFFER_TTL,
} from '../constants';

const REDIS_KEY_PREFIX = 'history:contributors:';
const EVENT_BUFFER_KEY_PREFIX = 'history:events:buffer:';
const EVENT_PROCESSING_KEY_PREFIX = 'history:events:processing:';

const MOVE_BUFFER_TO_PROCESSING_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
redis.call('RENAME', KEYS[1], KEYS[2])
return 1
`;

export interface IBufferedPageHistoryEvent {
  changeType: string;
  changeData: Record<string, unknown>;
  actorId?: string | null;
  createdAt: string;
}

@Injectable()
export class CollabHistoryService {
  private readonly redis: Redis;

  constructor(
    private readonly redisService: RedisService,
    @InjectQueue(QueueName.HISTORY_QUEUE)
    private readonly historyQueue: Queue,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  async addContributors(pageId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.sadd(REDIS_KEY_PREFIX + pageId, ...userIds);
  }

  async popContributors(pageId: string): Promise<string[]> {
    const key = REDIS_KEY_PREFIX + pageId;
    const count = await this.redis.scard(key);
    if (count === 0) return [];
    return await this.redis.spop(key, count);
  }

  async clearContributors(pageId: string): Promise<void> {
    await this.redis.del(REDIS_KEY_PREFIX + pageId);
  }

  async enqueuePageHistoryEvent(
    pageId: string,
    event: Omit<IBufferedPageHistoryEvent, 'createdAt'> & { createdAt?: string },
  ): Promise<void> {
    const eventWithTimestamp: IBufferedPageHistoryEvent = {
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };

    const bufferKey = this.getEventBufferKey(pageId);
    await this.redis
      .multi()
      .rpush(bufferKey, JSON.stringify(eventWithTimestamp))
      .pexpire(bufferKey, HISTORY_EVENT_BUFFER_TTL)
      .exec();

    await this.scheduleEventFlush(pageId);
  }

  async takeBufferedEventsForProcessing(
    pageId: string,
  ): Promise<IBufferedPageHistoryEvent[]> {
    const moved = await this.moveEventBufferToProcessing(pageId);
    if (!moved) {
      return [];
    }

    const rawEvents = await this.redis.lrange(
      this.getEventProcessingKey(pageId),
      0,
      -1,
    );

    return rawEvents
      .map((value) => {
        try {
          const parsed = JSON.parse(value) as IBufferedPageHistoryEvent;
          if (!parsed?.changeType) {
            return null;
          }

          return {
            changeType: parsed.changeType,
            changeData:
              parsed.changeData && typeof parsed.changeData === 'object'
                ? parsed.changeData
                : {},
            actorId:
              typeof parsed.actorId === 'string' ? parsed.actorId : null,
            createdAt:
              typeof parsed.createdAt === 'string'
                ? parsed.createdAt
                : new Date().toISOString(),
          } satisfies IBufferedPageHistoryEvent;
        } catch {
          return null;
        }
      })
      .filter((event) => event !== null) as IBufferedPageHistoryEvent[];
  }

  async clearBufferedProcessingEvents(pageId: string): Promise<void> {
    await this.redis.del(this.getEventProcessingKey(pageId));
  }

  async requeueBufferedProcessingEvents(pageId: string): Promise<void> {
    const processingKey = this.getEventProcessingKey(pageId);
    const bufferedKey = this.getEventBufferKey(pageId);
    const processingEvents = await this.redis.lrange(processingKey, 0, -1);

    if (processingEvents.length > 0) {
      await this.redis
        .multi()
        .lpush(bufferedKey, ...processingEvents.reverse())
        .pexpire(bufferedKey, HISTORY_EVENT_BUFFER_TTL)
        .del(processingKey)
        .exec();
    } else {
      await this.redis.del(processingKey);
    }

    await this.scheduleEventFlush(pageId);
  }

  async hasBufferedEvents(pageId: string): Promise<boolean> {
    const count = await this.redis.llen(this.getEventBufferKey(pageId));
    return count > 0;
  }

  async scheduleEventFlush(pageId: string): Promise<void> {
    await this.historyQueue.add(
      QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      { pageId } as IPageHistoryEventFlushJob,
      {
        jobId: this.getEventFlushJobId(pageId),
        delay: HISTORY_EVENT_AGGREGATION_WINDOW,
      },
    );
  }

  private async moveEventBufferToProcessing(pageId: string): Promise<boolean> {
    const result = await this.redis.eval(
      MOVE_BUFFER_TO_PROCESSING_LUA,
      2,
      this.getEventBufferKey(pageId),
      this.getEventProcessingKey(pageId),
    );

    return Number(result) === 1;
  }

  private getEventBufferKey(pageId: string): string {
    return EVENT_BUFFER_KEY_PREFIX + pageId;
  }

  private getEventProcessingKey(pageId: string): string {
    return EVENT_PROCESSING_KEY_PREFIX + pageId;
  }

  private getEventFlushJobId(pageId: string): string {
    return `${QueueJob.PAGE_HISTORY_EVENT_FLUSH}:${pageId}`;
  }
}
