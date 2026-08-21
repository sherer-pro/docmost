import { RagSyncStatus, RagSyncTargetTestResult } from '@docmost/api-contract';

export const RAG_SYNC_WRITER = Symbol('RAG_SYNC_WRITER');
export const RAG_SYNC_STATUS_READER = Symbol('RAG_SYNC_STATUS_READER');
export const RAG_SYNC_CONTROL = Symbol('RAG_SYNC_CONTROL');
export const RAG_SYNC_OPERATION_LOCK = Symbol('RAG_SYNC_OPERATION_LOCK');

export class RagSyncOperationLockError extends Error {
  constructor(readonly reason: 'busy' | 'lost' | 'unavailable') {
    super(`RAG sync operation lock ${reason}`);
    this.name = 'RagSyncOperationLockError';
  }
}

export interface RagSyncOperationLock {
  runExclusive<T>(
    workspaceId: string,
    spaceId: string,
    callback: (signal: AbortSignal) => Promise<T>,
    options?: { reserveGlobalSlot?: boolean },
  ): Promise<T>;
}

export interface RagSyncWriterTarget {
  bindingId: string;
  workspaceId: string;
  spaceId: string;
  adapter: 'open-webui-knowledge-v1';
  baseUrl: string;
  knowledgeId: string;
  configVersion: number;
  targetVersion: number;
}

export interface RagSyncWriter {
  preflightTarget(
    target: RagSyncWriterTarget,
    signal?: AbortSignal,
  ): Promise<void>;
  testTarget(
    target: RagSyncWriterTarget,
    signal?: AbortSignal,
  ): Promise<RagSyncTargetTestResult>;
}

export interface RagSyncStatusReader {
  getStatus(bindingId: string): Promise<RagSyncStatus | null>;
}

export interface RagSyncControl {
  bindingChanged(bindingId: string): Promise<void> | void;
}
