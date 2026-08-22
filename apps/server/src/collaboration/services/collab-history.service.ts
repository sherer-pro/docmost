import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { v7 as uuid7 } from 'uuid';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import {
  IPageHistoryEventFlushJob,
  IPageHistoryJob,
} from '../../integrations/queue/constants/queue.interface';
import {
  HISTORY_EVENT_AGGREGATION_WINDOW,
  HISTORY_INTERVAL,
  HISTORY_MAX_INTERVAL,
} from '../constants';

const REDIS_KEY_PREFIX = 'history:contributors:';
const EVENT_BUFFER_KEY_PREFIX = 'history:events:buffer:';
const EVENT_PROCESSING_KEY_PREFIX = 'history:events:processing:';
const CONTENT_DIRTY_KEY_PREFIX = 'history:content:dirty:';
const EVENT_DIRTY_KEY_PREFIX = 'history:events:dirty:';
const EVENT_PROCESSING_BATCH_KEY_PREFIX = 'history:events:processing-batch:';
const EVENT_PROCESSING_INDEX_KEY = 'history:events:processing-index';
const HISTORY_DIRTY_INDEX_KEY = 'history:dirty-index';
const ACTIVE_SUCCESSOR_JOB_SUFFIX = '-successor';
const EVENT_BATCH_RECOVERY_JOB_PREFIX = 'page-history-event-recovery-';
const EVENT_BATCH_RECOVERY_DELAY_MS = 60_000;
const DIRTY_STATE_RECOVERY_DELAY_MS = 60_000;

type LegacyHistoryScanKind =
  | 'eventProcessing'
  | 'eventBuffer'
  | 'eventDirty'
  | 'contentDirty';

type HistoryDirtyKind = 'content' | 'events';
type HistoryQueueJobData = IPageHistoryJob | IPageHistoryEventFlushJob;

const MARK_DIRTY_STATE_LUA = `
local now = tonumber(ARGV[1])
local idleWindowMs = tonumber(ARGV[2])
local maxWindowMs = tonumber(ARGV[3])
local firstDirtyAt = tonumber(redis.call('HGET', KEYS[1], 'firstDirtyAt'))
local previousLastDirtyAt = tonumber(redis.call('HGET', KEYS[1], 'lastDirtyAt'))

if not firstDirtyAt then
  firstDirtyAt = now
  redis.call('HSET', KEYS[1], 'firstDirtyAt', tostring(firstDirtyAt))
end
if not redis.call('HGET', KEYS[1], 'idleWindowMs') then
  redis.call('HSET', KEYS[1], 'idleWindowMs', tostring(idleWindowMs))
end
if not redis.call('HGET', KEYS[1], 'maxWindowMs') then
  redis.call('HSET', KEYS[1], 'maxWindowMs', tostring(maxWindowMs))
end

local lastDirtyAt = now
if previousLastDirtyAt and previousLastDirtyAt >= lastDirtyAt then
  lastDirtyAt = previousLastDirtyAt + 1
end

redis.call('HSET', KEYS[1], 'lastDirtyAt', tostring(lastDirtyAt))
redis.call('PERSIST', KEYS[1])

local configuredIdleWindowMs = tonumber(redis.call('HGET', KEYS[1], 'idleWindowMs'))
local configuredMaxWindowMs = tonumber(redis.call('HGET', KEYS[1], 'maxWindowMs'))
local dueAt = math.min(
  now + configuredIdleWindowMs,
  firstDirtyAt + configuredMaxWindowMs)
redis.call('HSET', KEYS[1], 'dueAt', tostring(dueAt))
redis.call('ZADD', KEYS[2], dueAt, ARGV[4])
return {lastDirtyAt, dueAt}
`;

const BUFFER_EVENT_AND_MARK_DIRTY_LUA = `
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('PERSIST', KEYS[1])

local now = tonumber(ARGV[2])
local idleWindowMs = tonumber(ARGV[3])
local maxWindowMs = tonumber(ARGV[4])
local firstDirtyAt = tonumber(redis.call('HGET', KEYS[2], 'firstDirtyAt'))
local previousLastDirtyAt = tonumber(redis.call('HGET', KEYS[2], 'lastDirtyAt'))

if not firstDirtyAt then
  firstDirtyAt = now
  redis.call('HSET', KEYS[2], 'firstDirtyAt', tostring(firstDirtyAt))
end
if not redis.call('HGET', KEYS[2], 'idleWindowMs') then
  redis.call('HSET', KEYS[2], 'idleWindowMs', tostring(idleWindowMs))
end
if not redis.call('HGET', KEYS[2], 'maxWindowMs') then
  redis.call('HSET', KEYS[2], 'maxWindowMs', tostring(maxWindowMs))
end

local lastDirtyAt = now
if previousLastDirtyAt and previousLastDirtyAt >= lastDirtyAt then
  lastDirtyAt = previousLastDirtyAt + 1
end

redis.call('HSET', KEYS[2], 'lastDirtyAt', tostring(lastDirtyAt))
redis.call('PERSIST', KEYS[2])

local configuredIdleWindowMs = tonumber(redis.call('HGET', KEYS[2], 'idleWindowMs'))
local configuredMaxWindowMs = tonumber(redis.call('HGET', KEYS[2], 'maxWindowMs'))
local dueAt = math.min(
  now + configuredIdleWindowMs,
  firstDirtyAt + configuredMaxWindowMs)
redis.call('HSET', KEYS[2], 'dueAt', tostring(dueAt))
redis.call('ZADD', KEYS[3], dueAt, ARGV[5])
return {lastDirtyAt, dueAt}
`;

const CLAIM_EVENT_BATCH_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  local existingBatchId = redis.call('GET', KEYS[3])
  if existingBatchId then
    redis.call('PERSIST', KEYS[2])
    redis.call('PERSIST', KEYS[3])
    redis.call('ZADD', KEYS[4], ARGV[2], ARGV[3] .. '|' .. existingBatchId)
    return existingBatchId
  end
  redis.call('SET', KEYS[3], ARGV[1])
  redis.call('PERSIST', KEYS[2])
  redis.call('PERSIST', KEYS[3])
  redis.call('ZADD', KEYS[4], ARGV[2], ARGV[3] .. '|' .. ARGV[1])
  return ARGV[1]
end
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[3])
  return ''
end
redis.call('SET', KEYS[3], ARGV[1])
redis.call('RENAME', KEYS[1], KEYS[2])
redis.call('PERSIST', KEYS[2])
redis.call('ZADD', KEYS[4], ARGV[2], ARGV[3] .. '|' .. ARGV[1])
return ARGV[1]
`;

const ACK_EVENT_BATCH_LUA = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('ZREM', KEYS[3], ARGV[2] .. '|' .. ARGV[1])
return 1
`;

const CLEAR_DIRTY_IF_LAST_MATCHES_LUA = `
if redis.call('HGET', KEYS[1], 'lastDirtyAt') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[2])
  return 1
end
return 0
`;

const DEFER_DIRTY_IF_LAST_MATCHES_LUA = `
if redis.call('HGET', KEYS[1], 'lastDirtyAt') == ARGV[1] then
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
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

export interface IProcessingPageHistoryEventBatch {
  batchId: string;
  events: IBufferedPageHistoryEvent[];
}

export interface IRecoverablePageHistoryEventBatch {
  pageId: string;
  batchId: string;
}

export interface IRecoverableHistoryDirtyState {
  kind: HistoryDirtyKind;
  pageId: string;
  lastDirtyAt: number;
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
  private readonly legacyScanCursors: Record<LegacyHistoryScanKind, string> = {
    eventProcessing: '0',
    eventBuffer: '0',
    eventDirty: '0',
    contentDirty: '0',
  };

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
    event: Omit<IBufferedPageHistoryEvent, 'createdAt'> & {
      createdAt?: string;
    },
  ): Promise<void> {
    const eventWithTimestamp: IBufferedPageHistoryEvent = {
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };

    await this.bufferEventAndMarkDirtyState(
      pageId,
      eventWithTimestamp,
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

  async getContentDirtyState(
    pageId: string,
  ): Promise<IHistoryDirtyState | null> {
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
  ): Promise<IProcessingPageHistoryEventBatch | null> {
    const batchId = await this.claimEventBatch(pageId);
    if (!batchId) {
      return null;
    }

    const rawEvents = await this.redis.lrange(
      this.getEventProcessingKey(pageId),
      0,
      -1,
    );

    const events = rawEvents
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
            actorId: typeof parsed.actorId === 'string' ? parsed.actorId : null,
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

    return { batchId, events };
  }

  async acknowledgeBufferedProcessingEvents(
    pageId: string,
    batchId: string,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      ACK_EVENT_BATCH_LUA,
      3,
      this.getEventProcessingKey(pageId),
      this.getEventProcessingBatchKey(pageId),
      EVENT_PROCESSING_INDEX_KEY,
      batchId,
      pageId,
    );

    return Number(result) === 1;
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

    if (dirtyState) {
      await this.deferDirtyStateRecovery(
        params.kind,
        params.pageId,
        dirtyState.lastDirtyAt,
        Math.max(dirtyState.dueAt, Date.now()) + DIRTY_STATE_RECOVERY_DELAY_MS,
      );
    }
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
        await this.scheduleActiveSuccessor(jobName, jobData, jobId, delay);
        return;
      } else {
        return;
      }
    }

    await this.addHistoryQueueJob(jobName, jobData, jobId, delay);
  }

  async getProcessingEventBatchId(pageId: string): Promise<string | null> {
    return this.redis.get(this.getEventProcessingBatchKey(pageId));
  }

  async scheduleEventBatchRecovery(
    pageId: string,
    batchId: string,
    delayMs = EVENT_BATCH_RECOVERY_DELAY_MS,
  ): Promise<void> {
    await this.scheduleHistoryQueueJob(
      QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      { pageId, batchId } as IPageHistoryEventFlushJob,
      this.getEventBatchRecoveryJobId(pageId, batchId),
      delayMs,
    );
  }

  async listRecoverableEventBatches(
    limit: number,
  ): Promise<IRecoverablePageHistoryEventBatch[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const members = await this.redis.zrangebyscore(
      EVENT_PROCESSING_INDEX_KEY,
      '-inf',
      Date.now(),
      'LIMIT',
      0,
      boundedLimit,
    );
    const recoverable: IRecoverablePageHistoryEventBatch[] = [];

    for (const member of members) {
      const separator = member.indexOf('|');
      if (separator <= 0 || separator === member.length - 1) {
        await this.redis.zrem(EVENT_PROCESSING_INDEX_KEY, member);
        continue;
      }
      const pageId = member.slice(0, separator);
      const batchId = member.slice(separator + 1);
      const currentBatchId = await this.getProcessingEventBatchId(pageId);
      if (currentBatchId !== batchId) {
        await this.redis.zrem(EVENT_PROCESSING_INDEX_KEY, member);
        continue;
      }
      recoverable.push({ pageId, batchId });
    }

    return recoverable;
  }

  async listRecoverableDirtyStates(
    limit: number,
  ): Promise<IRecoverableHistoryDirtyState[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const now = Date.now();
    const members = await this.redis.zrangebyscore(
      HISTORY_DIRTY_INDEX_KEY,
      '-inf',
      now,
      'LIMIT',
      0,
      boundedLimit,
    );
    const recoverable: IRecoverableHistoryDirtyState[] = [];

    for (const member of members) {
      const separator = member.indexOf('|');
      const kind = member.slice(0, separator) as HistoryDirtyKind;
      const pageId = member.slice(separator + 1);
      if (
        separator <= 0 ||
        pageId.length === 0 ||
        (kind !== 'content' && kind !== 'events')
      ) {
        await this.redis.zrem(HISTORY_DIRTY_INDEX_KEY, member);
        continue;
      }

      const dirtyState = await this.getDirtyState(kind, pageId);
      if (!dirtyState) {
        await this.redis.zrem(HISTORY_DIRTY_INDEX_KEY, member);
        continue;
      }

      if (dirtyState.dueAt > now) {
        await this.redis.zadd(
          HISTORY_DIRTY_INDEX_KEY,
          dirtyState.dueAt,
          member,
        );
        continue;
      }

      recoverable.push({ kind, pageId, lastDirtyAt: dirtyState.lastDirtyAt });
    }

    return recoverable;
  }

  async recoverLegacyUnindexedHistory(limit: number): Promise<void> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const processingKeys = await this.scanLegacyKeys(
      'eventProcessing',
      `${EVENT_PROCESSING_KEY_PREFIX}*`,
      boundedLimit,
    );
    for (const key of processingKeys) {
      const pageId = key.slice(EVENT_PROCESSING_KEY_PREFIX.length);
      if (
        pageId.length > 0 &&
        !(await this.getProcessingEventBatchId(pageId))
      ) {
        await this.claimEventBatch(pageId);
      }
    }

    await this.recoverLegacyDirtyKeys(
      'events',
      'eventDirty',
      EVENT_DIRTY_KEY_PREFIX,
      boundedLimit,
    );
    await this.recoverLegacyDirtyKeys(
      'content',
      'contentDirty',
      CONTENT_DIRTY_KEY_PREFIX,
      boundedLimit,
    );

    const bufferKeys = await this.scanLegacyKeys(
      'eventBuffer',
      `${EVENT_BUFFER_KEY_PREFIX}*`,
      boundedLimit,
    );
    for (const key of bufferKeys) {
      const pageId = key.slice(EVENT_BUFFER_KEY_PREFIX.length);
      if (!pageId || (await this.redis.llen(key)) === 0) continue;
      await this.redis.persist(key);
      const dirtyState = await this.getEventDirtyState(pageId);
      if (dirtyState) {
        await this.indexDirtyStateIfMissing('events', pageId, dirtyState.dueAt);
      } else {
        await this.markDirtyState(
          'events',
          pageId,
          HISTORY_EVENT_AGGREGATION_WINDOW,
          HISTORY_MAX_INTERVAL,
        );
      }
    }
  }

  async deferEventBatchRecovery(
    pageId: string,
    batchId: string,
  ): Promise<void> {
    const currentBatchId = await this.getProcessingEventBatchId(pageId);
    if (currentBatchId !== batchId) return;
    await this.redis.zadd(
      EVENT_PROCESSING_INDEX_KEY,
      Date.now() + EVENT_BATCH_RECOVERY_DELAY_MS,
      this.getEventProcessingIndexMember(pageId, batchId),
    );
  }

  private async scheduleActiveSuccessor(
    jobName: QueueJob.PAGE_HISTORY | QueueJob.PAGE_HISTORY_EVENT_FLUSH,
    jobData: HistoryQueueJobData,
    activeJobId: string,
    delay: number,
  ): Promise<void> {
    const successorId = this.getActiveSuccessorJobId(activeJobId);
    const successor = await this.historyQueue.getJob(successorId);

    if (successor) {
      const state = await successor.getState();
      if (state === 'delayed') {
        await successor.changeDelay(delay);
      } else if (state === 'completed' || state === 'failed') {
        await successor.remove();
        await this.addHistoryQueueJob(jobName, jobData, successorId, delay);
      }
      return;
    }

    await this.addHistoryQueueJob(jobName, jobData, successorId, delay);
  }

  private async addHistoryQueueJob(
    jobName: QueueJob.PAGE_HISTORY | QueueJob.PAGE_HISTORY_EVENT_FLUSH,
    jobData: HistoryQueueJobData,
    jobId: string,
    delay: number,
  ): Promise<Job> {
    return this.historyQueue.add(jobName, jobData, {
      jobId,
      delay,
      removeOnComplete: true,
    });
  }

  private async markDirtyState(
    kind: HistoryDirtyKind,
    pageId: string,
    idleWindowMs: number,
    maxWindowMs: number,
  ): Promise<void> {
    const now = Date.now();
    const safeIdleWindowMs = Math.max(0, Math.ceil(idleWindowMs));
    const safeMaxWindowMs = Math.max(safeIdleWindowMs, Math.ceil(maxWindowMs));

    await this.redis.eval(
      MARK_DIRTY_STATE_LUA,
      2,
      this.getDirtyKey(kind, pageId),
      HISTORY_DIRTY_INDEX_KEY,
      String(now),
      String(safeIdleWindowMs),
      String(safeMaxWindowMs),
      this.getDirtyIndexMember(kind, pageId),
    );
  }

  private async bufferEventAndMarkDirtyState(
    pageId: string,
    event: IBufferedPageHistoryEvent,
    idleWindowMs: number,
    maxWindowMs: number,
  ): Promise<void> {
    const now = Date.now();
    const safeIdleWindowMs = Math.max(0, Math.ceil(idleWindowMs));
    const safeMaxWindowMs = Math.max(safeIdleWindowMs, Math.ceil(maxWindowMs));

    await this.redis.eval(
      BUFFER_EVENT_AND_MARK_DIRTY_LUA,
      3,
      this.getEventBufferKey(pageId),
      this.getDirtyKey('events', pageId),
      HISTORY_DIRTY_INDEX_KEY,
      JSON.stringify(event),
      String(now),
      String(safeIdleWindowMs),
      String(safeMaxWindowMs),
      this.getDirtyIndexMember('events', pageId),
    );
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
    const persistedDueAt = this.parsePositiveNumber(rawState.dueAt);

    if (
      firstDirtyAt === null ||
      lastDirtyAt === null ||
      idleWindowMs === null ||
      maxWindowMs === null
    ) {
      return null;
    }

    const dueAt =
      persistedDueAt ??
      Math.min(lastDirtyAt + idleWindowMs, firstDirtyAt + maxWindowMs);

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
      2,
      this.getDirtyKey(kind, pageId),
      HISTORY_DIRTY_INDEX_KEY,
      String(expectedLastDirtyAt),
      this.getDirtyIndexMember(kind, pageId),
    );

    return Number(result) === 1;
  }

  private async claimEventBatch(pageId: string): Promise<string | null> {
    const nextBatchId = uuid7();
    const result = await this.redis.eval(
      CLAIM_EVENT_BATCH_LUA,
      4,
      this.getEventBufferKey(pageId),
      this.getEventProcessingKey(pageId),
      this.getEventProcessingBatchKey(pageId),
      EVENT_PROCESSING_INDEX_KEY,
      nextBatchId,
      String(Date.now() + EVENT_BATCH_RECOVERY_DELAY_MS),
      pageId,
    );

    const batchId = typeof result === 'string' ? result : String(result ?? '');
    return batchId.length > 0 ? batchId : null;
  }

  private getEventBufferKey(pageId: string): string {
    return EVENT_BUFFER_KEY_PREFIX + pageId;
  }

  private getEventProcessingKey(pageId: string): string {
    return EVENT_PROCESSING_KEY_PREFIX + pageId;
  }

  private getEventProcessingBatchKey(pageId: string): string {
    return EVENT_PROCESSING_BATCH_KEY_PREFIX + pageId;
  }

  private getEventProcessingIndexMember(
    pageId: string,
    batchId: string,
  ): string {
    return `${pageId}|${batchId}`;
  }

  private getContentHistoryJobId(pageId: string): string {
    return pageId;
  }

  private getEventFlushJobId(pageId: string): string {
    return `${QueueJob.PAGE_HISTORY_EVENT_FLUSH}-${pageId}`;
  }

  private getActiveSuccessorJobId(jobId: string): string {
    return `${jobId}${ACTIVE_SUCCESSOR_JOB_SUFFIX}`;
  }

  private getEventBatchRecoveryJobId(pageId: string, batchId: string): string {
    return `${EVENT_BATCH_RECOVERY_JOB_PREFIX}${pageId}-${batchId}`;
  }

  private getDirtyKey(kind: HistoryDirtyKind, pageId: string): string {
    const prefix =
      kind === 'content' ? CONTENT_DIRTY_KEY_PREFIX : EVENT_DIRTY_KEY_PREFIX;
    return prefix + pageId;
  }

  private getDirtyIndexMember(kind: HistoryDirtyKind, pageId: string): string {
    return `${kind}|${pageId}`;
  }

  private async recoverLegacyDirtyKeys(
    kind: HistoryDirtyKind,
    scanKind: 'eventDirty' | 'contentDirty',
    prefix: string,
    limit: number,
  ): Promise<void> {
    const keys = await this.scanLegacyKeys(scanKind, `${prefix}*`, limit);
    for (const key of keys) {
      const pageId = key.slice(prefix.length);
      if (!pageId) continue;
      await this.redis.persist(key);
      const dirtyState = await this.getDirtyState(kind, pageId);
      if (dirtyState) {
        await this.indexDirtyStateIfMissing(kind, pageId, dirtyState.dueAt);
      } else {
        await this.markDirtyState(
          kind,
          pageId,
          kind === 'events'
            ? HISTORY_EVENT_AGGREGATION_WINDOW
            : HISTORY_INTERVAL,
          HISTORY_MAX_INTERVAL,
        );
      }
    }
  }

  private async indexDirtyStateIfMissing(
    kind: HistoryDirtyKind,
    pageId: string,
    dueAt: number,
  ): Promise<void> {
    await this.redis.zadd(
      HISTORY_DIRTY_INDEX_KEY,
      'NX',
      dueAt,
      this.getDirtyIndexMember(kind, pageId),
    );
  }

  private async scanLegacyKeys(
    kind: LegacyHistoryScanKind,
    pattern: string,
    limit: number,
  ): Promise<string[]> {
    const [nextCursor, keys] = await this.redis.scan(
      this.legacyScanCursors[kind],
      'MATCH',
      pattern,
      'COUNT',
      limit,
    );
    this.legacyScanCursors[kind] = nextCursor;
    return keys;
  }

  private async deferDirtyStateRecovery(
    kind: HistoryDirtyKind,
    pageId: string,
    expectedLastDirtyAt: number,
    recoveryAt: number,
  ): Promise<void> {
    await this.redis.eval(
      DEFER_DIRTY_IF_LAST_MATCHES_LUA,
      2,
      this.getDirtyKey(kind, pageId),
      HISTORY_DIRTY_INDEX_KEY,
      String(expectedLastDirtyAt),
      String(recoveryAt),
      this.getDirtyIndexMember(kind, pageId),
    );
  }

  private parsePositiveNumber(value?: string): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
}
