import type { RagScope, RagSyncSourceType } from "@docmost/api-contract";

export type RagSyncBindingConfig = {
  id: string;
  workspaceId: string;
  spaceId: string;
  docmostBaseUrl: string;
  docmostApiKeyFile: string;
  openWebUiBaseUrl: string;
  openWebUiApiKeyFile: string;
  knowledgeId: string;
};

export type RagSyncConfig = {
  schemaVersion: 1;
  redisUrl: string;
  redisPrefix: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  processingTimeoutMs: number;
  maxAttachmentBytes: number;
  bindings: RagSyncBindingConfig[];
};

export type RagSyncBinding = RagSyncBindingConfig & {
  docmostApiKey: string;
  openWebUiApiKey: string;
};

export type DocmostMetadata = {
  schemaVersion: 1;
  workspaceId: string;
  spaceId: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string;
  databaseId?: string;
  sourceUpdatedAtMs: number;
  contentHash: string;
};

export type SyncSource = {
  identity: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string;
  databaseId?: string;
  updatedAtMs: number;
  fileName: string;
  mimeType: string;
  content: Uint8Array;
};

export type SourceMapping = {
  identity: string;
  fileId: string;
  contentHash: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string;
  databaseId?: string;
  updatedAtMs: number;
};

export type FeedCheckpointKind =
  | "updates"
  | "deleted"
  | "attachment-updates"
  | "attachment-deleted";

export type OpenWebUiFile = {
  id: string;
  filename?: string;
  meta?: {
    file_hash?: string;
    data?: Record<string, unknown>;
  };
  data?: {
    status?: string;
  };
};

export class OpenWebUiFileProcessingError extends Error {
  constructor(
    readonly fileId: string,
    readonly status: "failed" | "not_found" | "timeout",
  ) {
    super("Open WebUI failed to process an uploaded file");
    this.name = "OpenWebUiFileProcessingError";
  }
}

export interface SyncStateStore {
  acquireLock(
    bindingId: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean>;
  renewLock(bindingId: string, token: string, ttlMs: number): Promise<boolean>;
  releaseLock(bindingId: string, token: string): Promise<void>;
  getCheckpoint(bindingId: string, kind: FeedCheckpointKind): Promise<number>;
  setCheckpoint(
    bindingId: string,
    kind: FeedCheckpointKind,
    value: number,
  ): Promise<void>;
  getScopeFingerprint(bindingId: string): Promise<string | null>;
  setScopeFingerprint(bindingId: string, fingerprint: string): Promise<void>;
  getMapping(
    bindingId: string,
    identity: string,
  ): Promise<SourceMapping | null>;
  listMappings(bindingId: string): Promise<SourceMapping[]>;
  setMapping(bindingId: string, mapping: SourceMapping): Promise<void>;
  deleteMapping(bindingId: string, identity: string): Promise<void>;
  close(): Promise<void>;
}

export interface DocmostSourceClient {
  getScope(signal?: AbortSignal): Promise<RagScope>;
  getBlockedPages(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<
    import("@docmost/api-contract").RagChangeFeed<
      import("@docmost/api-contract").RagBlockedPageItem
    >
  >;
  getUpdates(
    updatedSince: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<
    import("@docmost/api-contract").RagChangeFeed<
      import("@docmost/api-contract").RagUpdateItem
    >
  >;
  getDeleted(
    deletedSince: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<
    import("@docmost/api-contract").RagChangeFeed<
      import("@docmost/api-contract").RagDeletedItem
    >
  >;
  getAttachmentUpdates(
    updatedSince: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<
    import("@docmost/api-contract").RagChangeFeed<
      import("@docmost/api-contract").RagAttachmentItem
    >
  >;
  getAttachmentDeleted(
    deletedSince: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<
    import("@docmost/api-contract").RagChangeFeed<
      import("@docmost/api-contract").RagAttachmentDeletedItem
    >
  >;
  getPage(
    pageId: string,
    signal?: AbortSignal,
  ): Promise<import("@docmost/api-contract").RagPageDetail>;
  getDatabase(
    databaseId: string,
    signal?: AbortSignal,
  ): Promise<import("@docmost/api-contract").RagDatabaseDetail>;
  downloadAttachment(
    item: import("@docmost/api-contract").RagAttachmentItem,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

export interface OpenWebUiWriterClient {
  upload(
    fileName: string,
    mimeType: string,
    content: Uint8Array,
    metadata: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OpenWebUiFile>;
  waitUntilProcessed(
    fileId: string,
    assertActive?: () => void,
    signal?: AbortSignal,
  ): Promise<void>;
  deleteFile(fileId: string, signal?: AbortSignal): Promise<void>;
  listKnowledgeFiles(signal?: AbortSignal): Promise<OpenWebUiFile[]>;
}
