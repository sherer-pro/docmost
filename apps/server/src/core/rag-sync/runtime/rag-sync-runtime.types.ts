import type { RagSyncSourceType } from '@docmost/api-contract';

export const RAG_SYNC_BINDING_REGISTRY = Symbol('RAG_SYNC_BINDING_REGISTRY');
export const RAG_SYNC_QUANTUM_PROCESSOR = Symbol('RAG_SYNC_QUANTUM_PROCESSOR');

export type RagSyncRuntimeBindingState = 'enabled' | 'draining';

export interface RagSyncRuntimeBinding {
  id: string;
  workspaceId: string;
  spaceId: string;
  state: RagSyncRuntimeBindingState;
  adapter: 'open-webui-knowledge-v1';
  baseUrl: string;
  knowledgeId: string;
  /** Used only by isolated writer tests; discovery bindings never carry keys. */
  writerApiKey?: string;
  configVersion: number;
  targetVersion: number;
  updatedAtMs: number;
}

export interface RagSyncBindingRegistry {
  listRunnableBindings(): Promise<RagSyncRuntimeBinding[]>;
  stopForRuntimeError(
    bindingId: string,
    expectedConfigVersion: number,
    expectedTargetVersion: number,
    resetTargetTest: boolean,
  ): Promise<boolean>;
  completeDrain(
    bindingId: string,
    expectedConfigVersion: number,
    expectedTargetVersion: number,
  ): Promise<void>;
}

export interface RagSyncLease {
  bindingId: string;
  targetVersion: number;
  token: string;
}

export type RagSyncFeedKind =
  | 'updates'
  | 'deleted'
  | 'attachment-updates'
  | 'attachment-deleted'
  | 'dictionary-updates'
  | 'dictionary-deleted';

export interface RagSyncFeedProgress {
  baseCheckpoint: number;
  cursor: string | null;
  maxSeen: number;
}

export type RagSyncDatabaseWorkProgress =
  | {
      operation: 'upsert';
      databaseId: string;
      pageId: string;
      sourceUpdatedAtMs: number;
      phase: 'document' | 'rows' | 'stale-rows';
      rowCursor: string | null;
      mappingCursor: string;
      mappingChangedInPass: boolean;
    }
  | {
      operation: 'delete';
      databaseId: string;
      pageId: string;
      phase: 'document' | 'rows';
      mappingCursor: string;
      mappingChangedInPass: boolean;
    };

export interface RagSyncSourceMapping {
  identity: string;
  fileId: string;
  operationId: string;
  contentHash: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string | null;
  databaseId?: string;
  updatedAtMs: number;
}

export interface RagSyncUploadIntent {
  operationId: string;
  identity: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string | null;
  databaseId?: string;
  configVersion: number;
  createdAt: number;
  notBefore: number;
  cleanupRequested?: boolean;
  scanPage?: number;
  scanPass?: 1 | 2;
  scanExpectedTotal?: number;
  scanDigest?: string;
  firstPassDigest?: string;
}

export interface RagSyncRemoteScanProgress {
  configVersion: number;
  phase: 'files' | 'mappings' | 'intents';
  page: number;
  mappingCursor: string;
  expectedTotal: number | null;
  scopeFingerprint: string | null;
  barrierUntil?: number;
  stablePasses?: 0 | 1 | 2;
  scanDigest?: string;
  firstPassDigest?: string;
}

export type RagSyncRemoteScanPurpose =
  | 'reconcile'
  | 'drain'
  | 'policy'
  | { kind: 'intent'; operationId: string }
  | { kind: 'deletion'; identityHash: string };

export interface RagSyncOperationalStatus {
  health: 'disabled' | 'idle' | 'syncing' | 'healthy' | 'degraded' | 'error';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lagMs: number | null;
  errorCode: string | null;
  processedCount?: number;
}

export interface RagSyncQuantumContext {
  lease: RagSyncLease;
  signal: AbortSignal;
  maxItems: number;
  maxConcurrentDocuments: number;
  maxAttachmentBytes: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  processingTimeoutMs: number;
  reconcileIntervalMs: number;
}

export interface RagSyncQuantumResult {
  hasMore: boolean;
  drained?: boolean;
  retryAfterMs?: number;
  lagMs?: number | null;
  processedCount?: number;
}

export interface RagSyncQuantumProcessor {
  processQuantum(
    binding: RagSyncRuntimeBinding,
    context: RagSyncQuantumContext,
  ): Promise<RagSyncQuantumResult>;
}

export type RagSyncDocmostMetadataV2 = {
  schemaVersion: 2;
  bindingId: string;
  targetVersion: number;
  workspaceId: string;
  spaceId: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string | null;
  databaseId?: string;
  sourceUpdatedAtMs: number;
  contentHash: string;
  operationId: string;
  ownershipMac?: string;
  marker?: 'target-test';
};

export type RagSyncLegacyDocmostMetadata = {
  schemaVersion: 1;
  workspaceId: string;
  spaceId: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string | null;
  databaseId?: string;
  sourceUpdatedAtMs: number;
  contentHash: string;
};

export type RagSyncRemoteOwnership =
  | { schemaVersion: 2; metadata: RagSyncDocmostMetadataV2 }
  | { schemaVersion: 1; metadata: RagSyncLegacyDocmostMetadata };

export type OpenWebUiFile = {
  id: string;
  filename?: string;
  meta?: {
    file_hash?: string;
    data?: Record<string, unknown>;
    docmost?: unknown;
  };
  data?: {
    status?: string;
  };
};

export class RagSyncRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = 'RAG synchronization failed',
  ) {
    super(message);
    this.name = 'RagSyncRuntimeError';
  }
}

export type RagSyncDiagnosticStage =
  | 'scope'
  | 'drain'
  | 'policy'
  | 'reconcile'
  | `feed:${RagSyncFeedKind}`;

export type RagSyncDiagnosticSourceKind =
  | 'binding'
  | 'page'
  | 'database'
  | 'database-row'
  | 'attachment'
  | 'dictionary-term'
  | 'tombstone'
  | 'unknown';

export class RagSyncDiagnosticError extends Error {
  constructor(
    readonly stage: RagSyncDiagnosticStage,
    readonly sourceKind: RagSyncDiagnosticSourceKind,
    readonly originalError: unknown,
  ) {
    super(
      originalError instanceof Error
        ? originalError.message
        : 'RAG synchronization stage failed',
    );
    this.name = 'RagSyncDiagnosticError';
  }
}

export class RagSyncLeaseLostError extends RagSyncRuntimeError {
  constructor() {
    super('rag_sync_lease_lost', true, 'RAG synchronization lease was lost');
    this.name = 'RagSyncLeaseLostError';
  }
}

export class OpenWebUiProcessingError extends RagSyncRuntimeError {
  constructor(
    readonly fileId: string,
    readonly status: 'failed' | 'not_found' | 'timeout',
  ) {
    super(
      status === 'timeout'
        ? 'rag_sync_processing_timeout'
        : 'rag_sync_processing_failed',
      status === 'timeout',
      'Open WebUI failed to process an uploaded file',
    );
    this.name = 'OpenWebUiProcessingError';
  }
}
