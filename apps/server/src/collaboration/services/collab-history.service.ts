import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import {
  IPageHistoryEventFlushJob,
  IPageHistoryJob,
} from '../../integrations/queue/constants/queue.interface';
import {
  HISTORY_EVENT_AGGREGATION_WINDOW,
  HISTORY_EVENT_BUFFER_TTL,
  HISTORY_INTERVAL,
  HISTORY_MAX_INTERVAL,
} from '../constants';

const REDIS_KEY_PREFIX = 'history:contributors:';
const EVENT_BUFFER_KEY_PREFIX = 'history:events:buffer:';
const EVENT_PROCESSING_KEY_PREFIX = 'history:events:processing:';
const CONTENT_DIRTY_KEY_PREFIX = 'history:content:dirty:';
const EVENT_DIRTY_KEY_PREFIX = 'history:events:dirty:';
const ACTIVE_RETRY_JOB_SUFFIX = ':retry:';

type HistoryDirtyKind = 'content' | 'events';
type HistoryQueueJobData = IPageHistoryJob | IPageHistoryEventFlushJob;

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

const CLEAR_DIRTY_IF_LAST_MATCHES_LUA = `
if redis.call('HGET', KEYS[1], 'lastDirtyAt') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export interface IBufferedPageHistoryEvent {
  changeType: string;
  changeData: Record<string, unknown>;
  actorId?: string | null;
  createdAt: string;
}

export interface IHistoryDirtyState {
  firstDirtyAt: number;
  lastDirtyAt: number;
  idleWindowMs: number;
  maxWindowMs: number;
  dueAt: number;
  delayMs: number;
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

    await this.markDirtyState(
      'events',
      pageId,
      HISTORY_EVENT_AGGREGATION_WINDOW,
      HISTORY_MAX_INTERVAL,
    );
    await this.scheduleEventFlush(pageId);
  }

  async enqueuePageContentHistory(
    pageId: string,
    idleWindowMs: number,
    maxWindowMs: number,
  ): Promise<void> {
    await this.markDirtyState('content', pageId, idleWindowMs, maxWindowMs);
    await this.scheduleContentHistoryFlush(pageId);
  }

  async getContentDirtyState(pageId: string): Promise<IHistoryDirtyState | null> {
    return this.getDirtyState('content', pageId);
  }

  async getEventDirtyState(pageId: string): Promise<IHistoryDirtyState | null> {
    return this.getDirtyState('events', pageId);
  }

  async clearContentDirtyState(
    pageId: string,
    expectedLastDirtyAt: number,
  ): Promise<boolean> {
    return this.clearDirtyState('content', pageId, expectedLastDirtyAt);
  }

  async clearEventDirtyState(
    pageId: string,
    expectedLastDirtyAt: number,
  ): Promise<boolean> {
    return this.clearDirtyState('events', pageId, expectedLastDirtyAt);
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
    await this.scheduleDirtyQueueJob({
      kind: 'events',
      pageId,
      jobName: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      jobData: { pageId } as IPageHistoryEventFlushJob,
      jobId: this.getEventFlushJobId(pageId),
      fallbackDelayMs: HISTORY_EVENT_AGGREGATION_WINDOW,
    });
  }

  async scheduleContentHistoryFlush(pageId: string): Promise<void> {
    await this.scheduleDirtyQueueJob({
      kind: 'content',
      pageId,
      jobName: QueueJob.PAGE_HISTORY,
      jobData: { pageId } as IPageHistoryJob,
      jobId: this.getContentHistoryJobId(pageId),
      fallbackDelayMs: HISTORY_INTERVAL,
    });
  }

  private async scheduleDirtyQueueJob(params: {
    kind: HistoryDirtyKind;
    pageId: string;
    jobName: QueueJob.PAGE_HISTORY | QueueJob.PAGE_HISTORY_EVENT_FLUSH;
    jobData: HistoryQueueJobData;
    jobId: string;
    fallbackDelayMs: number;
  }): Promise<void> {
    const dirtyState = await this.getDirtyState(params.kind, params.pageId);
    const delay = dirtyState?.delayMs ?? params.fallbackDelayMs;

    await this.scheduleHistoryQueueJob(
      params.jobName,
      params.jobData,
      params.jobId,
      delay,
    );
  }

  private async scheduleHistoryQueueJob(
    jobName: QueueJob.PAGE_HISTORY | QueueJob.PAGE_HISTORY_EVENT_FLUSH,
    jobData: HistoryQueueJobData,
    jobId: string,
    delayMs: number,
  ): Promise<void> {
    const delay = Math.max(0, Math.ceil(delayMs));
    const existingJob = await this.historyQueue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();

      if (state === 'delayed') {
        await existingJob.changeDelay(delay);
        return;
      }

      if (state === 'completed' || state === 'failed') {
        await existingJob.remove();
      } else if (state === 'active') {
        await this.addHistoryQueueJob(
          jobName,
          jobData,
          this.getActiveRetryJobId(jobId),
          delay,
        );
        return;
      } else {
        return;
      }
    }

    await this.addHistoryQueueJob(jobName, jobData, jobId, delay);
  }

  private async addHistoryQueueJob(
    jobName: QueueJob.PAGE_HISTORY | QueueJob.PAGE_HISTORY_EVENT_FLUSH,
    jobData: HistoryQueueJobData,
    jobId: string,
    delay: number,
  ): Promise<Job> {
    return this.historyQueue.add(
      jobName,
      jobData,
      {
        jobId,
        delay,
        removeOnComplete: true,
      },
    );
  }

  private async markDirtyState(
    kind: HistoryDirtyKind,
    pageId: string,
    idleWindowMs: number,
    maxWindowMs: number,
  ): Promise<void> {
    const key = this.getDirtyKey(kind, pageId);
    const now = Date.now();
    const safeIdleWindowMs = Math.max(0, Math.ceil(idleWindowMs));
    const safeMaxWindowMs = Math.max(safeIdleWindowMs, Math.ceil(maxWindowMs));
    const nowValue = String(now);

    await Promise.all([
      this.redis.hsetnx(key, 'firstDirtyAt', nowValue),
      this.redis.hsetnx(key, 'idleWindowMs', String(safeIdleWindowMs)),
      this.redis.hsetnx(key, 'maxWindowMs', String(safeMaxWindowMs)),
    ]);

    await this.redis
      .multi()
      .hset(key, 'lastDirtyAt', nowValue)
      .pexpire(key, this.getDirtyStateTtl(safeIdleWindowMs, safeMaxWindowMs))
      .exec();
  }

  private async getDirtyState(
    kind: HistoryDirtyKind,
    pageId: string,
  ): Promise<IHistoryDirtyState | null> {
    const rawState = await this.redis.hgetall(this.getDirtyKey(kind, pageId));
    const firstDirtyAt = this.parsePositiveNumber(rawState.firstDirtyAt);
    const lastDirtyAt = this.parsePositiveNumber(rawState.lastDirtyAt);
    const idleWindowMs = this.parsePositiveNumber(rawState.idleWindowMs);
    const maxWindowMs = this.parsePositiveNumber(rawState.maxWindowMs);

    if (
      firstDirtyAt === null ||
      lastDirtyAt === null ||
      idleWindowMs === null ||
      maxWindowMs === null
    ) {
      return null;
    }

    const dueAt = Math.min(
      lastDirtyAt + idleWindowMs,
      firstDirtyAt + maxWindowMs,
    );

    return {
      firstDirtyAt,
      lastDirtyAt,
      idleWindowMs,
      maxWindowMs,
      dueAt,
      delayMs: Math.max(0, dueAt - Date.now()),
    };
  }

  private async clearDirtyState(
    kind: HistoryDirtyKind,
    pageId: string,
    expectedLastDirtyAt: number,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      CLEAR_DIRTY_IF_LAST_MATCHES_LUA,
      1,
      this.getDirtyKey(kind, pageId),
      String(expectedLastDirtyAt),
    );

    return Number(result) === 1;
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

  private getContentHistoryJobId(pageId: string): string {
    return pageId;
  }

  private getEventFlushJobId(pageId: string): string {
    return `${QueueJob.PAGE_HISTORY_EVENT_FLUSH}-${pageId}`;
  }

  private getActiveRetryJobId(jobId: string): string {
    return `${jobId}${ACTIVE_RETRY_JOB_SUFFIX}${Date.now()}`;
  }

  private getDirtyKey(kind: HistoryDirtyKind, pageId: string): string {
    const prefix =
      kind === 'content' ? CONTENT_DIRTY_KEY_PREFIX : EVENT_DIRTY_KEY_PREFIX;
    return prefix + pageId;
  }

  private getDirtyStateTtl(idleWindowMs: number, maxWindowMs: number): number {
    return Math.max(idleWindowMs, maxWindowMs) + HISTORY_EVENT_BUFFER_TTL;
  }

  private parsePositiveNumber(value?: string): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
}
