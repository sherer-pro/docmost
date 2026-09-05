import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  RAG_SYNC_ERROR_CODES,
  RAG_SYNC_HEALTH_STATES,
  RAG_CONTENT_PROCESSOR_IDS,
} from '@docmost/api-contract';
import {
  RagSyncOperationLock,
  RagSyncOperationLockError,
} from '../admin/rag-sync-admin.ports';
import { RagSyncRuntimeConfigService } from './rag-sync-runtime.config';
import {
  RagSyncDatabaseWorkProgress,
  RagSyncFeedKind,
  RagSyncFeedProgress,
  RagSyncLease,
  RagSyncLeaseLostError,
  RagSyncOperationalStatus,
  RagSyncRemoteScanPurpose,
  RagSyncRemoteScanProgress,
  RagSyncRuntimeError,
  RagSyncSourceMapping,
  RagSyncUploadIntent,
} from './rag-sync-runtime.types';

export const RENEW_RAG_SYNC_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export const RELEASE_RAG_SYNC_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export const FENCED_RAG_SYNC_HSET_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[2], 2592000000)
return 1
`;

export const FENCED_RAG_SYNC_HDEL_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('HDEL', KEYS[2], ARGV[2])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('PEXPIRE', KEYS[2], 2592000000)
end
return 1
`;

export const FENCED_RAG_SYNC_SET_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('PEXPIRE', KEYS[2], 2592000000)
return 1
`;

export const FENCED_RAG_SYNC_DEL_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[2])
return 1
`;

const FENCED_RAG_SYNC_MARK_SCAN_IDS_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
for index = 2, #ARGV do
  if redis.call('HEXISTS', KEYS[2], ARGV[index]) == 1 then return -1 end
end
for index = 2, #ARGV do
  redis.call('HSET', KEYS[2], ARGV[index], '1')
end
redis.call('PEXPIRE', KEYS[2], 86400000)
return 1
`;

const ACQUIRE_GLOBAL_SLOT_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
return 1
`;

const RENEW_GLOBAL_SLOT_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1
`;

type RagSyncScanOverflow = {
  sourceCursor: string;
  nextCursor: string;
  fields: string[];
  issuedToken?: string;
  issuedCount?: number;
};

type RagSyncScanBatch<T> = {
  cursor: string;
  items: T[];
  hasMore: boolean;
  ackToken: string | null;
};

@Injectable()
export class RagSyncStateStore
  implements OnModuleDestroy, RagSyncOperationLock
{
  private readonly logger = new Logger(RagSyncStateStore.name);
  private readonly redis: Redis;
  private closed = false;

  constructor(
    redisService: RedisService,
    private readonly config: RagSyncRuntimeConfigService,
  ) {
    const commandTimeout = Math.max(
      1_000,
      Math.min(5_000, this.config.requestTimeoutMs),
    );
    this.redis = redisService.getOrThrow().duplicate({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout,
      connectTimeout: commandTimeout,
    });
    this.redis.on('error', () => {
      this.logger.error('RAG sync Redis connection failed');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async acquireLease(
    bindingId: string,
    targetVersion: number,
    ttlMs: number,
  ): Promise<RagSyncLease | null> {
    this.assertBinding(bindingId, targetVersion);
    const token = randomUUID();
    const acquired = await this.redis.set(
      this.lockKey(bindingId),
      token,
      'PX',
      ttlMs,
      'NX',
    );
    return acquired === 'OK' ? { bindingId, targetVersion, token } : null;
  }

  async renewLease(lease: RagSyncLease, ttlMs: number): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(
          RENEW_RAG_SYNC_LEASE_SCRIPT,
          1,
          this.lockKey(lease.bindingId),
          lease.token,
          ttlMs,
        ),
      ) === 1
    );
  }

  async releaseLease(lease: RagSyncLease): Promise<void> {
    await this.redis.eval(
      RELEASE_RAG_SYNC_LEASE_SCRIPT,
      1,
      this.lockKey(lease.bindingId),
      lease.token,
    );
  }

  async getTimeMs(): Promise<number> {
    const response = await this.redis.time();
    const seconds = Number(response?.[0]);
    const microseconds = Number(response?.[1]);
    const value = seconds * 1_000 + Math.floor(microseconds / 1_000);
    if (
      !Number.isSafeInteger(seconds) ||
      seconds < 0 ||
      !Number.isSafeInteger(microseconds) ||
      microseconds < 0 ||
      microseconds >= 1_000_000 ||
      !Number.isSafeInteger(value)
    ) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    return value;
  }

  async acquireGlobalSlot(
    slotToken: string,
    maxConcurrent: number,
    ttlMs: number,
  ): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(
          ACQUIRE_GLOBAL_SLOT_SCRIPT,
          1,
          this.globalSlotsKey(),
          maxConcurrent,
          slotToken,
          ttlMs,
        ),
      ) === 1
    );
  }

  async renewGlobalSlot(slotToken: string, ttlMs: number): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(
          RENEW_GLOBAL_SLOT_SCRIPT,
          1,
          this.globalSlotsKey(),
          slotToken,
          ttlMs,
        ),
      ) === 1
    );
  }

  async releaseGlobalSlot(slotToken: string): Promise<void> {
    await this.redis.zrem(this.globalSlotsKey(), slotToken);
  }

  async runExclusive<T>(
    workspaceId: string,
    spaceId: string,
    callback: (signal: AbortSignal) => Promise<T>,
    options?: { reserveGlobalSlot?: boolean },
  ): Promise<T> {
    this.assertKeyPart(workspaceId, 'workspace id');
    this.assertKeyPart(spaceId, 'space id');
    if (this.closed) throw new RagSyncOperationLockError('unavailable');

    const key = this.operationLockKey(workspaceId, spaceId);
    const token = randomUUID();
    const ttlMs = Math.max(
      30_000,
      Math.min(120_000, this.config.requestTimeoutMs * 3),
    );
    let acquired: string | null;
    try {
      acquired = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    } catch {
      throw new RagSyncOperationLockError('unavailable');
    }
    if (acquired !== 'OK') throw new RagSyncOperationLockError('busy');

    const slotToken = options?.reserveGlobalSlot ? `admin-${token}` : null;
    let slotAcquired = false;
    if (slotToken) {
      try {
        slotAcquired = await this.acquireGlobalSlot(
          slotToken,
          this.config.maxConcurrentBindings,
          ttlMs,
        );
      } catch {
        await this.releaseOperationLock(key, token);
        throw new RagSyncOperationLockError('unavailable');
      }
      if (!slotAcquired) {
        await this.releaseOperationLock(key, token);
        throw new RagSyncOperationLockError('busy');
      }
    }

    const operationController = new AbortController();
    const renewalController = new AbortController();
    const renewal = this.renewOperationLock(
      key,
      token,
      slotToken,
      ttlMs,
      operationController,
      renewalController.signal,
    );
    try {
      const result = await callback(operationController.signal);
      if (operationController.signal.aborted) {
        throw operationController.signal.reason;
      }
      return result;
    } finally {
      renewalController.abort();
      await renewal;
      if (slotToken && slotAcquired) {
        try {
          await this.releaseGlobalSlot(slotToken);
        } catch {
          this.logger.warn('Failed to release RAG sync global operation slot');
        }
      }
      await this.releaseOperationLock(key, token);
    }
  }

  async getCheckpoint(
    lease: RagSyncLease,
    kind: RagSyncFeedKind,
  ): Promise<number> {
    const value = await this.redis.hget(
      this.stateKey(lease, 'checkpoints'),
      kind,
    );
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  async setCheckpoint(
    lease: RagSyncLease,
    kind: RagSyncFeedKind,
    value: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('RAG sync checkpoint must be a non-negative integer');
    }
    await this.fencedHset(lease, 'checkpoints', kind, String(value));
  }

  async getFeedProgress(
    lease: RagSyncLease,
    kind: RagSyncFeedKind,
  ): Promise<RagSyncFeedProgress | null> {
    const raw = await this.redis.hget(
      this.stateKey(lease, 'feed-progress'),
      kind,
    );
    const progress = this.parseJson(raw, isFeedProgress);
    if (raw && !progress) {
      await this.fencedHdel(lease, 'feed-progress', kind);
      await this.setReconcileAt(lease, 0);
    }
    return progress;
  }

  async setFeedProgress(
    lease: RagSyncLease,
    kind: RagSyncFeedKind,
    progress: RagSyncFeedProgress | null,
  ): Promise<void> {
    if (progress === null) {
      await this.fencedHdel(lease, 'feed-progress', kind);
      return;
    }
    if (!isFeedProgress(progress)) {
      throw new Error('RAG sync feed progress is invalid');
    }
    await this.fencedHset(
      lease,
      'feed-progress',
      kind,
      JSON.stringify(progress),
    );
  }

  async getDrainStartedAt(
    lease: RagSyncLease,
    configVersion: number,
  ): Promise<number | null> {
    const field = 'drain-started-at';
    const raw = await this.redis.hget(
      this.stateKey(lease, 'feed-progress'),
      field,
    );
    if (raw === null) return null;
    const observation = this.parseJson(raw, isDrainTimeObservation);
    if (!observation) {
      await this.fencedHdel(lease, 'feed-progress', field);
      await this.setReconcileAt(lease, 0);
      return null;
    }
    if (observation.configVersion !== configVersion) {
      await this.fencedHdel(lease, 'feed-progress', field);
      return null;
    }
    return observation.observedAt;
  }

  async setDrainStartedAt(
    lease: RagSyncLease,
    configVersion: number,
    value: number,
  ): Promise<void> {
    const field = 'drain-started-at';
    const observation = { configVersion, observedAt: value };
    if (!isDrainTimeObservation(observation)) {
      throw new Error('RAG sync drain start is invalid');
    }
    await this.fencedHset(
      lease,
      'feed-progress',
      field,
      JSON.stringify(observation),
    );
  }

  async getDrainEmptyObservedAt(
    lease: RagSyncLease,
    configVersion: number,
  ): Promise<number | null> {
    const field = 'drain-empty-observed-at';
    const raw = await this.redis.hget(
      this.stateKey(lease, 'feed-progress'),
      field,
    );
    if (raw === null) return null;
    const observation = this.parseJson(raw, isDrainTimeObservation);
    if (!observation) {
      await this.fencedHdel(lease, 'feed-progress', field);
      await this.setReconcileAt(lease, 0);
      return null;
    }
    if (observation.configVersion !== configVersion) {
      await this.fencedHdel(lease, 'feed-progress', field);
      return null;
    }
    return observation.observedAt;
  }

  async setDrainEmptyObservedAt(
    lease: RagSyncLease,
    configVersion: number,
    value: number | null,
  ): Promise<void> {
    const field = 'drain-empty-observed-at';
    if (value === null) {
      await this.fencedHdel(lease, 'feed-progress', field);
      return;
    }
    const observation = { configVersion, observedAt: value };
    if (!isDrainTimeObservation(observation)) {
      throw new Error('RAG sync drain observation is invalid');
    }
    await this.fencedHset(
      lease,
      'feed-progress',
      field,
      JSON.stringify(observation),
    );
  }

  async getUploadIntent(
    lease: RagSyncLease,
    operationId: string,
  ): Promise<RagSyncUploadIntent | null> {
    this.assertOperationId(operationId);
    const raw = await this.redis.hget(
      this.stateKey(lease, 'upload-intents'),
      operationId,
    );
    const intent = this.parseJson(raw, isUploadIntent);
    if (raw && (!intent || intent.operationId !== operationId)) {
      await this.fencedHdel(lease, 'upload-intents', operationId);
      await this.setReconcileAt(lease, 0);
      return null;
    }
    return intent;
  }

  async hasUploadIntents(lease: RagSyncLease): Promise<boolean> {
    return (await this.redis.hlen(this.stateKey(lease, 'upload-intents'))) > 0;
  }

  async scanUploadIntents(
    lease: RagSyncLease,
    cursor: string,
    count: number,
    scanId = 'default',
  ): Promise<RagSyncScanBatch<RagSyncUploadIntent>> {
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(count) || count < 1) {
      throw new Error('RAG sync upload intent scan request is invalid');
    }
    this.assertScanId(scanId);
    const overflow = await this.getScanOverflow(
      lease,
      'upload-intents',
      scanId,
      cursor,
    );
    if (overflow) {
      return this.peekScanOverflow(
        lease,
        'upload-intents',
        scanId,
        overflow,
        count,
        isUploadIntent,
      );
    }
    const response = await this.redis.hscan(
      this.stateKey(lease, 'upload-intents'),
      cursor,
      'COUNT',
      count,
    );
    const nextCursor = response[0];
    const entries = response[1];
    if (!/^\d+$/.test(nextCursor) || entries.length % 2 !== 0) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    const intents: RagSyncUploadIntent[] = [];
    let corrupted = false;
    for (let index = 0; index < entries.length; index += 2) {
      const operationId = entries[index];
      const intent = this.parseJson(entries[index + 1], isUploadIntent);
      if (!intent || intent.operationId !== operationId) {
        corrupted = true;
        if (/^[0-9a-f]{64}$/.test(operationId)) {
          await this.clearRemoteScanSeen(lease, {
            kind: 'intent',
            operationId,
          });
        }
        await this.fencedHdel(lease, 'upload-intents', operationId);
        continue;
      }
      intents.push(intent);
    }
    if (corrupted) await this.setReconcileAt(lease, 0);
    return this.boundScanResult(
      lease,
      'upload-intents',
      scanId,
      cursor,
      nextCursor,
      intents,
      count,
      (intent) => intent.operationId,
    );
  }

  async setUploadIntent(
    lease: RagSyncLease,
    intent: RagSyncUploadIntent,
  ): Promise<void> {
    if (!isUploadIntent(intent)) {
      throw new Error('RAG sync upload intent is invalid');
    }
    await this.fencedHset(
      lease,
      'upload-intents',
      intent.operationId,
      JSON.stringify(intent),
    );
  }

  async deleteUploadIntent(
    lease: RagSyncLease,
    operationId: string,
  ): Promise<void> {
    this.assertOperationId(operationId);
    await this.clearRemoteScanSeen(lease, {
      kind: 'intent',
      operationId,
    });
    await this.fencedHdel(lease, 'upload-intents', operationId);
  }

  async getRemoteScanProgress(
    lease: RagSyncLease,
    purpose: RagSyncRemoteScanPurpose,
    configVersion: number,
    scopeFingerprint: string | null = null,
  ): Promise<RagSyncRemoteScanProgress | null> {
    const field = this.remoteScanField(purpose);
    const raw = await this.redis.hget(
      this.stateKey(lease, 'feed-progress'),
      field,
    );
    const progress = this.parseJson(raw, isRemoteScanProgress);
    if (
      !progress ||
      progress.configVersion !== configVersion ||
      progress.scopeFingerprint !== scopeFingerprint
    ) {
      if (raw) await this.fencedHdel(lease, 'feed-progress', field);
      return null;
    }
    return progress;
  }

  async setRemoteScanProgress(
    lease: RagSyncLease,
    purpose: RagSyncRemoteScanPurpose,
    progress: RagSyncRemoteScanProgress | null,
  ): Promise<void> {
    const field = this.remoteScanField(purpose);
    if (progress === null) {
      await this.fencedHdel(lease, 'feed-progress', field);
      return;
    }
    if (!isRemoteScanProgress(progress)) {
      throw new Error('RAG sync remote scan progress is invalid');
    }
    await this.fencedHset(
      lease,
      'feed-progress',
      field,
      JSON.stringify(progress),
    );
  }

  async clearRemoteScanSeen(
    lease: RagSyncLease,
    purpose: RagSyncRemoteScanPurpose,
  ): Promise<void> {
    await this.fencedDel(
      lease,
      `remote-scan-seen:${this.remoteScanPurposeKey(purpose)}`,
    );
  }

  async markRemoteScanFileIds(
    lease: RagSyncLease,
    purpose: RagSyncRemoteScanPurpose,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    for (const fileId of fileIds) {
      if (!/^[0-9a-f]{16}$/.test(fileId)) {
        throw new Error('RAG sync file id fingerprint is invalid');
      }
    }
    if (new Set(fileIds).size !== fileIds.length) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    const result = Number(
      await this.redis.eval(
        FENCED_RAG_SYNC_MARK_SCAN_IDS_SCRIPT,
        2,
        this.lockKey(lease.bindingId),
        this.stateKey(
          lease,
          `remote-scan-seen:${this.remoteScanPurposeKey(purpose)}`,
        ),
        lease.token,
        ...fileIds,
      ),
    );
    if (result === -1) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    this.assertFenced(result);
  }

  async wasRemoteScanFileIdSeen(
    lease: RagSyncLease,
    purpose: RagSyncRemoteScanPurpose,
    fileIdFingerprint: string,
  ): Promise<boolean> {
    if (!/^[0-9a-f]{16}$/.test(fileIdFingerprint)) {
      throw new Error('RAG sync file id fingerprint is invalid');
    }
    return (
      Number(
        await this.redis.hexists(
          this.stateKey(
            lease,
            `remote-scan-seen:${this.remoteScanPurposeKey(purpose)}`,
          ),
          fileIdFingerprint,
        ),
      ) === 1
    );
  }

  async scanMappings(
    lease: RagSyncLease,
    cursor: string,
    count: number,
    scanId = 'default',
  ): Promise<RagSyncScanBatch<RagSyncSourceMapping>> {
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(count) || count < 1) {
      throw new Error('RAG sync mapping scan request is invalid');
    }
    this.assertScanId(scanId);
    const overflow = await this.getScanOverflow(
      lease,
      'mappings',
      scanId,
      cursor,
    );
    if (overflow) {
      return this.peekScanOverflow(
        lease,
        'mappings',
        scanId,
        overflow,
        count,
        isSourceMapping,
      );
    }
    const response = await this.redis.hscan(
      this.stateKey(lease, 'mappings'),
      cursor,
      'COUNT',
      count,
    );
    const nextCursor = response[0];
    const entries = response[1];
    if (!/^\d+$/.test(nextCursor) || entries.length % 2 !== 0) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    const items: RagSyncSourceMapping[] = [];
    let corrupted = false;
    for (let index = 0; index < entries.length; index += 2) {
      const identity = entries[index];
      const mapping = this.parseJson(entries[index + 1], isSourceMapping);
      if (!mapping || mapping.identity !== identity) {
        corrupted = true;
        await this.fencedHdel(lease, 'mappings', identity);
        continue;
      }
      items.push(mapping);
    }
    if (corrupted) await this.setReconcileAt(lease, 0);
    return this.boundScanResult(
      lease,
      'mappings',
      scanId,
      cursor,
      nextCursor,
      items,
      count,
      (mapping) => mapping.identity,
    );
  }

  async clearScanOverflow(
    lease: RagSyncLease,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
  ): Promise<void> {
    this.assertScanId(scanId);
    await this.fencedHdel(
      lease,
      'scan-overflows',
      this.scanOverflowField(kind, scanId),
    );
  }

  async ackScanBatch(
    lease: RagSyncLease,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
    ackToken: string,
  ): Promise<void> {
    this.assertScanId(scanId);
    if (!/^[A-Za-z0-9-]{1,100}$/.test(ackToken)) {
      throw new Error('RAG sync scan acknowledgement is invalid');
    }
    const overflow = await this.getScanOverflowByField(lease, kind, scanId);
    if (
      !overflow ||
      overflow.issuedToken !== ackToken ||
      !Number.isSafeInteger(overflow.issuedCount) ||
      Number(overflow.issuedCount) < 1 ||
      Number(overflow.issuedCount) > overflow.fields.length
    ) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    await this.fencedHset(
      lease,
      'scan-overflows',
      this.scanOverflowField(kind, scanId),
      JSON.stringify({
        sourceCursor: overflow.sourceCursor,
        nextCursor: overflow.nextCursor,
        fields: overflow.fields.slice(Number(overflow.issuedCount)),
      }),
    );
  }

  async getDatabaseWorkProgress(
    lease: RagSyncLease,
    operation: RagSyncDatabaseWorkProgress['operation'],
    databaseId: string,
  ): Promise<RagSyncDatabaseWorkProgress | null> {
    const field = this.databaseWorkField(operation, databaseId);
    const raw = await this.redis.hget(
      this.stateKey(lease, 'feed-progress'),
      field,
    );
    const progress = this.parseJson(raw, isDatabaseWorkProgress);
    if (
      raw &&
      (!progress ||
        progress.operation !== operation ||
        progress.databaseId !== databaseId)
    ) {
      await this.fencedHdel(lease, 'feed-progress', field);
      await this.setReconcileAt(lease, 0);
      return null;
    }
    return progress;
  }

  async setDatabaseWorkProgress(
    lease: RagSyncLease,
    progress: RagSyncDatabaseWorkProgress,
  ): Promise<void> {
    if (!isDatabaseWorkProgress(progress)) {
      throw new Error('RAG sync database work progress is invalid');
    }
    await this.fencedHset(
      lease,
      'feed-progress',
      this.databaseWorkField(progress.operation, progress.databaseId),
      JSON.stringify(progress),
    );
  }

  async deleteDatabaseWorkProgress(
    lease: RagSyncLease,
    operation: RagSyncDatabaseWorkProgress['operation'],
    databaseId: string,
  ): Promise<void> {
    await this.fencedHdel(
      lease,
      'feed-progress',
      this.databaseWorkField(operation, databaseId),
    );
  }

  async clearDatabaseWorkProgress(lease: RagSyncLease): Promise<void> {
    await this.fencedDel(lease, 'feed-progress');
    await this.fencedDel(lease, 'scan-overflows');
  }

  async getScopeFingerprint(lease: RagSyncLease): Promise<string | null> {
    return this.redis.get(this.stateKey(lease, 'scope-fingerprint'));
  }

  async setScopeFingerprint(
    lease: RagSyncLease,
    fingerprint: string,
  ): Promise<void> {
    await this.fencedSet(lease, 'scope-fingerprint', fingerprint);
  }

  async getReconcileAt(lease: RagSyncLease): Promise<number | null> {
    const parsed = Number(
      await this.redis.get(this.stateKey(lease, 'reconcile-at')),
    );
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  async setReconcileAt(lease: RagSyncLease, value: number): Promise<void> {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('RAG sync reconciliation time must be non-negative');
    }
    await this.fencedSet(lease, 'reconcile-at', String(value));
  }

  async getMapping(
    lease: RagSyncLease,
    identity: string,
  ): Promise<RagSyncSourceMapping | null> {
    const raw = await this.redis.hget(
      this.stateKey(lease, 'mappings'),
      identity,
    );
    const mapping = this.parseJson(raw, isSourceMapping);
    if (raw && (!mapping || mapping.identity !== identity)) {
      await this.fencedHdel(lease, 'mappings', identity);
      await this.setReconcileAt(lease, 0);
      return null;
    }
    return mapping;
  }

  async setMapping(
    lease: RagSyncLease,
    mapping: RagSyncSourceMapping,
  ): Promise<void> {
    if (!isSourceMapping(mapping)) {
      throw new Error('RAG sync source mapping is invalid');
    }
    await this.fencedHset(
      lease,
      'mappings',
      mapping.identity,
      JSON.stringify(mapping),
    );
  }

  async deleteMapping(lease: RagSyncLease, identity: string): Promise<void> {
    await this.fencedHdel(lease, 'mappings', identity);
  }

  async getStatus(bindingId: string): Promise<RagSyncOperationalStatus | null> {
    this.assertKeyPart(bindingId, 'binding id');
    return this.parseJson(
      await this.redis.get(this.statusKey(bindingId)),
      isOperationalStatus,
    );
  }

  async setStatus(
    lease: RagSyncLease,
    status: RagSyncOperationalStatus,
  ): Promise<void> {
    if (!isOperationalStatus(status)) {
      throw new Error('RAG sync operational status is invalid');
    }
    const result = await this.redis.eval(
      FENCED_RAG_SYNC_SET_SCRIPT,
      2,
      this.lockKey(lease.bindingId),
      this.statusKey(lease.bindingId),
      lease.token,
      JSON.stringify(status),
    );
    this.assertFenced(result);
  }

  async clearTargetState(lease: RagSyncLease): Promise<void> {
    for (const suffix of [
      'checkpoints',
      'feed-progress',
      'scope-fingerprint',
      'mappings',
      'upload-intents',
      'scan-overflows',
      'reconcile-at',
      'remote-scan-seen:reconcile',
      'remote-scan-seen:drain',
      'remote-scan-seen:policy',
      'remote-scan-seen:intent',
    ]) {
      const result = await this.redis.eval(
        FENCED_RAG_SYNC_DEL_SCRIPT,
        2,
        this.lockKey(lease.bindingId),
        this.stateKey(lease, suffix),
        lease.token,
      );
      this.assertFenced(result);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      this.redis.disconnect(false);
      return;
    }
    const timeoutMs = Math.max(
      1_000,
      Math.min(
        5_000,
        this.config.shutdownTimeoutMs ?? this.config.requestTimeoutMs,
      ),
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve(this.redis.quit()),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('RAG sync Redis shutdown timed out')),
            timeoutMs,
          );
          timer.unref();
        }),
      ]);
    } catch {
      this.redis.disconnect(false);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async fencedHset(
    lease: RagSyncLease,
    suffix: string,
    field: string,
    value: string,
  ): Promise<void> {
    const result = await this.redis.eval(
      FENCED_RAG_SYNC_HSET_SCRIPT,
      2,
      this.lockKey(lease.bindingId),
      this.stateKey(lease, suffix),
      lease.token,
      field,
      value,
    );
    this.assertFenced(result);
  }

  private async getScanOverflow(
    lease: RagSyncLease,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
    sourceCursor: string,
  ): Promise<RagSyncScanOverflow | null> {
    const parsed = await this.getScanOverflowByField(lease, kind, scanId);
    if (!parsed) return null;
    if (parsed.sourceCursor !== sourceCursor) {
      await this.fencedHdel(
        lease,
        'scan-overflows',
        this.scanOverflowField(kind, scanId),
      );
      return null;
    }
    return parsed;
  }

  private async getScanOverflowByField(
    lease: RagSyncLease,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
  ): Promise<RagSyncScanOverflow | null> {
    const field = this.scanOverflowField(kind, scanId);
    const raw = await this.redis.hget(
      this.stateKey(lease, 'scan-overflows'),
      field,
    );
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const valid = Boolean(
      isRecord(parsed) &&
        typeof parsed.sourceCursor === 'string' &&
        /^\d+$/.test(parsed.sourceCursor) &&
        typeof parsed.nextCursor === 'string' &&
        /^\d+$/.test(parsed.nextCursor) &&
        Array.isArray(parsed.fields) &&
        parsed.fields.length <= 10_000 &&
        parsed.fields.every((field) => this.isScanField(kind, field)) &&
        new Set(parsed.fields).size === parsed.fields.length &&
        ((parsed.issuedToken === undefined &&
          parsed.issuedCount === undefined) ||
          (typeof parsed.issuedToken === 'string' &&
            /^[A-Za-z0-9-]{1,100}$/.test(parsed.issuedToken) &&
            Number.isSafeInteger(parsed.issuedCount) &&
            Number(parsed.issuedCount) >= 1 &&
            Number(parsed.issuedCount) <= parsed.fields.length)),
    );
    if (!valid) {
      await this.fencedHdel(lease, 'scan-overflows', field);
      await this.setReconcileAt(lease, 0);
      return null;
    }
    return parsed as RagSyncScanOverflow;
  }

  private async peekScanOverflow<T>(
    lease: RagSyncLease,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
    overflow: RagSyncScanOverflow,
    count: number,
    validateItem: (value: unknown) => value is T,
  ): Promise<RagSyncScanBatch<T>> {
    if (overflow.fields.length === 0) {
      await this.fencedHdel(
        lease,
        'scan-overflows',
        this.scanOverflowField(kind, scanId),
      );
      return {
        cursor: overflow.nextCursor,
        items: [],
        hasMore: overflow.nextCursor !== '0',
        ackToken: null,
      };
    }
    const issuedCount =
      overflow.issuedCount ?? Math.min(count, overflow.fields.length);
    const ackToken = overflow.issuedToken ?? randomUUID();
    if (!overflow.issuedToken) {
      overflow = { ...overflow, issuedCount, issuedToken: ackToken };
      await this.fencedHset(
        lease,
        'scan-overflows',
        this.scanOverflowField(kind, scanId),
        JSON.stringify(overflow),
      );
    }
    const fields = overflow.fields.slice(0, issuedCount);
    const values = await this.redis.hmget(
      this.stateKey(lease, kind),
      ...fields,
    );
    if (!Array.isArray(values) || values.length !== fields.length) {
      throw new RagSyncRuntimeError('rag_sync_invalid_response', false);
    }
    const items: T[] = [];
    let corrupted = false;
    for (let index = 0; index < fields.length; index += 1) {
      const raw = values[index];
      if (raw === null) continue;
      const item = this.parseJson(raw, validateItem);
      const expectedField = this.scanItemField(kind, item);
      if (!item || expectedField !== fields[index]) {
        corrupted = true;
        await this.fencedHdel(lease, kind, fields[index]);
        continue;
      }
      items.push(item);
    }
    if (corrupted) await this.setReconcileAt(lease, 0);
    return {
      cursor: overflow.sourceCursor,
      items,
      hasMore: true,
      ackToken,
    };
  }

  private async boundScanResult<T>(
    lease: RagSyncLease,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
    sourceCursor: string,
    nextCursor: string,
    items: T[],
    count: number,
    fieldOf: (item: T) => string,
  ): Promise<RagSyncScanBatch<T>> {
    if (items.length === 0) {
      return {
        cursor: nextCursor,
        items: [],
        hasMore: nextCursor !== '0',
        ackToken: null,
      };
    }
    const overflow: RagSyncScanOverflow = {
      sourceCursor,
      nextCursor,
      fields: items.map(fieldOf),
    };
    await this.fencedHset(
      lease,
      'scan-overflows',
      this.scanOverflowField(kind, scanId),
      JSON.stringify(overflow),
    );
    return this.peekScanOverflow(
      lease,
      kind,
      scanId,
      overflow,
      count,
      kind === 'mappings'
        ? (isSourceMapping as (value: unknown) => value is T)
        : (isUploadIntent as (value: unknown) => value is T),
    );
  }

  private isScanField(
    kind: 'mappings' | 'upload-intents',
    field: unknown,
  ): field is string {
    return kind === 'upload-intents'
      ? typeof field === 'string' && /^[0-9a-f]{64}$/.test(field)
      : typeof field === 'string' && /^[A-Za-z0-9_:-]{1,500}$/.test(field);
  }

  private scanItemField<T>(
    kind: 'mappings' | 'upload-intents',
    item: T | null,
  ): string | null {
    if (!item || !isRecord(item)) return null;
    const record = item as Record<string, unknown>;
    return kind === 'upload-intents'
      ? typeof record.operationId === 'string'
        ? record.operationId
        : null
      : typeof record.identity === 'string'
        ? record.identity
        : null;
  }

  private async fencedHdel(
    lease: RagSyncLease,
    suffix: string,
    field: string,
  ): Promise<void> {
    const result = await this.redis.eval(
      FENCED_RAG_SYNC_HDEL_SCRIPT,
      2,
      this.lockKey(lease.bindingId),
      this.stateKey(lease, suffix),
      lease.token,
      field,
    );
    this.assertFenced(result);
  }

  private async fencedSet(
    lease: RagSyncLease,
    suffix: string,
    value: string,
  ): Promise<void> {
    const result = await this.redis.eval(
      FENCED_RAG_SYNC_SET_SCRIPT,
      2,
      this.lockKey(lease.bindingId),
      this.stateKey(lease, suffix),
      lease.token,
      value,
    );
    this.assertFenced(result);
  }

  private async fencedDel(lease: RagSyncLease, suffix: string): Promise<void> {
    const result = await this.redis.eval(
      FENCED_RAG_SYNC_DEL_SCRIPT,
      2,
      this.lockKey(lease.bindingId),
      this.stateKey(lease, suffix),
      lease.token,
    );
    this.assertFenced(result);
  }

  private assertFenced(result: unknown): void {
    if (Number(result) !== 1) throw new RagSyncLeaseLostError();
  }

  private parseJson<T>(
    value: string | null,
    validate: (candidate: unknown) => candidate is T,
  ): T | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      return validate(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private lockKey(bindingId: string): string {
    this.assertKeyPart(bindingId, 'binding id');
    return `${this.config.redisPrefix}:v2:lock:${bindingId}`;
  }

  private stateKey(lease: RagSyncLease, suffix: string): string {
    this.assertBinding(lease.bindingId, lease.targetVersion);
    return `${this.config.redisPrefix}:v2:state:${lease.bindingId}:${lease.targetVersion}:${suffix}`;
  }

  private statusKey(bindingId: string): string {
    return `${this.config.redisPrefix}:v2:status:${bindingId}`;
  }

  private globalSlotsKey(): string {
    return `${this.config.redisPrefix}:v2:global-slots`;
  }

  private operationLockKey(workspaceId: string, spaceId: string): string {
    return `${this.config.redisPrefix}:v2:admin-lock:${workspaceId}:${spaceId}`;
  }

  private async renewOperationLock(
    key: string,
    token: string,
    slotToken: string | null,
    ttlMs: number,
    operationController: AbortController,
    stopSignal: AbortSignal,
  ): Promise<void> {
    while (!stopSignal.aborted) {
      await waitForStop(Math.max(1_000, Math.floor(ttlMs / 3)), stopSignal);
      if (stopSignal.aborted) return;
      try {
        const renewed = Number(
          await this.redis.eval(
            RENEW_RAG_SYNC_LEASE_SCRIPT,
            1,
            key,
            token,
            ttlMs,
          ),
        );
        const slotRenewed = slotToken
          ? await this.renewGlobalSlot(slotToken, ttlMs)
          : true;
        if (renewed !== 1 || !slotRenewed) {
          operationController.abort(new RagSyncOperationLockError('lost'));
          return;
        }
      } catch {
        operationController.abort(new RagSyncOperationLockError('unavailable'));
        return;
      }
    }
  }

  private async releaseOperationLock(
    key: string,
    token: string,
  ): Promise<void> {
    try {
      await this.redis.eval(RELEASE_RAG_SYNC_LEASE_SCRIPT, 1, key, token);
    } catch {
      this.logger.warn('Failed to release RAG sync operation lock');
    }
  }

  private databaseWorkField(
    operation: RagSyncDatabaseWorkProgress['operation'],
    databaseId: string,
  ): string {
    this.assertKeyPart(databaseId, 'database id');
    return `database:${operation}:${databaseId}`;
  }

  private scanOverflowField(
    kind: 'mappings' | 'upload-intents',
    scanId: string,
  ): string {
    return `${kind}:${scanId}`;
  }

  private remoteScanField(purpose: RagSyncRemoteScanPurpose): string {
    return `remote-scan:${this.remoteScanPurposeKey(purpose)}`;
  }

  private remoteScanPurposeKey(purpose: RagSyncRemoteScanPurpose): string {
    if (typeof purpose === 'string') return purpose;
    if (purpose.kind === 'intent') {
      this.assertOperationId(purpose.operationId);
      return `intent:${purpose.operationId}`;
    }
    if (!/^[0-9a-f]{64}$/.test(purpose.identityHash)) {
      throw new Error('RAG sync deletion identity hash is invalid');
    }
    return `deletion:${purpose.identityHash}`;
  }

  private assertBinding(bindingId: string, targetVersion: number): void {
    this.assertKeyPart(bindingId, 'binding id');
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) {
      throw new Error('RAG sync target version must be a positive integer');
    }
  }

  private assertKeyPart(value: string, label: string): void {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
      throw new Error(`RAG sync ${label} is invalid`);
    }
  }

  private assertOperationId(operationId: string): void {
    if (!/^[0-9a-f]{64}$/.test(operationId)) {
      throw new Error('RAG sync operation id is invalid');
    }
  }

  private assertScanId(scanId: string): void {
    if (!/^[A-Za-z0-9:_-]{1,500}$/.test(scanId)) {
      throw new Error('RAG sync scan id is invalid');
    }
  }
}

function isFeedProgress(value: unknown): value is RagSyncFeedProgress {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInteger(value.baseCheckpoint) &&
    (value.cursor === null ||
      (typeof value.cursor === 'string' && value.cursor.length <= 4096)) &&
    isNonNegativeInteger(value.maxSeen) &&
    value.maxSeen >= value.baseCheckpoint
  );
}

function isDatabaseWorkProgress(
  value: unknown,
): value is RagSyncDatabaseWorkProgress {
  if (
    !isRecord(value) ||
    !['upsert', 'delete'].includes(String(value.operation)) ||
    typeof value.databaseId !== 'string' ||
    !isKeyPart(value.databaseId) ||
    typeof value.pageId !== 'string' ||
    !isKeyPart(value.pageId) ||
    !['document', 'rows', 'stale-rows'].includes(String(value.phase))
  ) {
    return false;
  }
  if (value.operation === 'upsert') {
    return (
      isNonNegativeInteger(value.sourceUpdatedAtMs) &&
      (value.rowCursor === null ||
        (typeof value.rowCursor === 'string' &&
          value.rowCursor.length > 0 &&
          value.rowCursor.length <= 4096)) &&
      typeof value.mappingCursor === 'string' &&
      /^\d+$/.test(value.mappingCursor) &&
      typeof value.mappingChangedInPass === 'boolean'
    );
  }
  return (
    value.operation === 'delete' &&
    value.phase !== 'stale-rows' &&
    typeof value.mappingCursor === 'string' &&
    /^\d+$/.test(value.mappingCursor) &&
    typeof value.mappingChangedInPass === 'boolean'
  );
}

function isDrainTimeObservation(
  value: unknown,
): value is { configVersion: number; observedAt: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate.configVersion) &&
    Number(candidate.configVersion) >= 1 &&
    Number.isSafeInteger(candidate.observedAt) &&
    Number(candidate.observedAt) >= 0
  );
}

function isUploadIntent(value: unknown): value is RagSyncUploadIntent {
  if (!isRecord(value)) return false;
  const sourceType = String(value.sourceType);
  return (
    typeof value.operationId === 'string' &&
    /^[0-9a-f]{64}$/.test(value.operationId) &&
    ['page', 'database_row', 'attachment', 'dictionary_term'].includes(
      sourceType,
    ) &&
    typeof value.sourceId === 'string' &&
    isKeyPart(value.sourceId) &&
    isMappingIdentity(value, sourceType) &&
    isSourcePageId(value.sourceType, value.pageId) &&
    (value.databaseId === undefined ||
      (typeof value.databaseId === 'string' && isKeyPart(value.databaseId))) &&
    (sourceType !== 'database_row' || typeof value.databaseId === 'string') &&
    (sourceType !== 'attachment' || value.databaseId === undefined) &&
    (sourceType !== 'dictionary_term' || value.databaseId === undefined) &&
    isNonNegativeInteger(value.configVersion) &&
    value.configVersion >= 1 &&
    isNonNegativeInteger(value.createdAt) &&
    isNonNegativeInteger(value.notBefore) &&
    value.notBefore >= value.createdAt &&
    (value.cleanupRequested === undefined ||
      typeof value.cleanupRequested === 'boolean') &&
    (value.scanPage === undefined ||
      (Number.isSafeInteger(value.scanPage) && Number(value.scanPage) >= 1)) &&
    (value.scanPass === undefined ||
      value.scanPass === 1 ||
      value.scanPass === 2) &&
    (value.scanExpectedTotal === undefined ||
      (Number.isSafeInteger(value.scanExpectedTotal) &&
        Number(value.scanExpectedTotal) >= 0)) &&
    (value.scanDigest === undefined ||
      (typeof value.scanDigest === 'string' &&
        /^[0-9a-f]{64}$/.test(value.scanDigest))) &&
    (value.firstPassDigest === undefined ||
      (typeof value.firstPassDigest === 'string' &&
        /^[0-9a-f]{64}$/.test(value.firstPassDigest)))
  );
}

function isMappingIdentity(
  value: Record<string, any>,
  sourceType: string,
): boolean {
  const logicalIdentity = `${sourceType}:${value.sourceId}`;
  const hasProjection =
    value.projectorId !== undefined ||
    value.projectionVersion !== undefined ||
    value.partId !== undefined ||
    value.partIndex !== undefined ||
    value.partCount !== undefined;
  if (!hasProjection) return value.identity === logicalIdentity;
  if (
    !RAG_CONTENT_PROCESSOR_IDS.includes(value.projectorId) ||
    !isNonNegativeInteger(value.projectionVersion) ||
    value.projectionVersion < 1 ||
    typeof value.partId !== 'string' ||
    !value.partId ||
    value.partId.length > 128 ||
    !isNonNegativeInteger(value.partIndex) ||
    !isNonNegativeInteger(value.partCount) ||
    value.partCount < 1 ||
    value.partIndex >= value.partCount
  ) {
    return false;
  }
  const expectedIdentity =
    value.partCount > 1
      ? `${logicalIdentity}:${value.projectorId}:${encodeURIComponent(value.partId)}`
      : logicalIdentity;
  return value.identity === expectedIdentity;
}

function isRemoteScanProgress(
  value: unknown,
): value is RagSyncRemoteScanProgress {
  return Boolean(
    isRecord(value) &&
      Number.isSafeInteger(value.configVersion) &&
      Number(value.configVersion) >= 1 &&
      ['files', 'mappings', 'intents'].includes(String(value.phase)) &&
      Number.isSafeInteger(value.page) &&
      Number(value.page) >= 1 &&
      typeof value.mappingCursor === 'string' &&
      /^\d+$/.test(value.mappingCursor) &&
      (value.expectedTotal === null ||
        (Number.isSafeInteger(value.expectedTotal) &&
          Number(value.expectedTotal) >= 0)) &&
      (value.scopeFingerprint === null ||
        (typeof value.scopeFingerprint === 'string' &&
          /^[0-9a-f]{64}$/.test(value.scopeFingerprint))) &&
      (value.barrierUntil === undefined ||
        isNonNegativeInteger(value.barrierUntil)) &&
      (value.stablePasses === undefined ||
        value.stablePasses === 0 ||
        value.stablePasses === 1 ||
        value.stablePasses === 2) &&
      (value.scanDigest === undefined ||
        (typeof value.scanDigest === 'string' &&
          /^[0-9a-f]{64}$/.test(value.scanDigest))) &&
      (value.firstPassDigest === undefined ||
        (typeof value.firstPassDigest === 'string' &&
          /^[0-9a-f]{64}$/.test(value.firstPassDigest))),
  );
}

function waitForStop(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isSourceMapping(value: unknown): value is RagSyncSourceMapping {
  if (!isRecord(value)) return false;
  const sourceType = String(value.sourceType);
  return (
    ['page', 'database_row', 'attachment', 'dictionary_term'].includes(
      sourceType,
    ) &&
    typeof value.sourceId === 'string' &&
    isKeyPart(value.sourceId) &&
    value.identity === `${sourceType}:${value.sourceId}` &&
    typeof value.fileId === 'string' &&
    isKeyPart(value.fileId) &&
    typeof value.operationId === 'string' &&
    /^[a-f0-9]{64}$/.test(value.operationId) &&
    typeof value.contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.contentHash) &&
    isSourcePageId(value.sourceType, value.pageId) &&
    (value.databaseId === undefined ||
      (typeof value.databaseId === 'string' && isKeyPart(value.databaseId))) &&
    isNonNegativeInteger(value.updatedAtMs)
  );
}

function isOperationalStatus(
  value: unknown,
): value is RagSyncOperationalStatus {
  if (!isRecord(value)) return false;
  return (
    RAG_SYNC_HEALTH_STATES.includes(value.health as never) &&
    isNullableIsoDate(value.lastAttemptAt) &&
    isNullableIsoDate(value.lastSuccessAt) &&
    (value.lagMs === null || isNonNegativeInteger(value.lagMs)) &&
    (value.errorCode === null ||
      RAG_SYNC_ERROR_CODES.includes(value.errorCode as never)) &&
    (value.processedCount === undefined ||
      isNonNegativeInteger(value.processedCount))
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isKeyPart(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function isSourcePageId(sourceType: unknown, pageId: unknown): boolean {
  return sourceType === 'dictionary_term'
    ? pageId === null
    : typeof pageId === 'string' && isKeyPart(pageId);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableIsoDate(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= 64 &&
      Number.isFinite(Date.parse(value)))
  );
}
