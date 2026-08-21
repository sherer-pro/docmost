import { Injectable, Optional } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Dispatcher } from 'undici';
import { createAiPinnedDispatcher } from '../../ai/services/ai-pinned-http.util';
import { AiOutboundUrlPolicyService } from '../../ai/services/ai-outbound-url-policy.service';
import {
  decryptProtectedValue,
  isEncryptedProtectedValue,
  safeStringEqual,
} from '../../../common/security/credential-protection.util';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { RagSyncAdminRepo } from '../admin/rag-sync-admin.repo';
import { RagSyncRuntimeConfigService } from './rag-sync-runtime.config';
import {
  OpenWebUiFile,
  OpenWebUiProcessingError,
  RagSyncDocmostMetadataV2,
  RagSyncLegacyDocmostMetadata,
  RagSyncRemoteOwnership,
  RagSyncRuntimeBinding,
  RagSyncRuntimeError,
} from './rag-sync-runtime.types';

const KNOWLEDGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_KNOWLEDGE_SCAN_FILES = 100_000;
// Open WebUI ignores a caller-supplied limit for non-admin users and uses its
// default PAGE_ITEM_COUNT (currently 30). Keep offsets aligned with that
// least-privilege contract so a writer key does not need global admin rights.
const KNOWLEDGE_PAGE_SIZE = 30;
const MAX_TARGET_TEST_SCAN_PAGES = 20;
const TARGET_TEST_TIMEOUT_MS = 120_000;

type WriterRequest = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: BodyInit;
  requestBytes?: number;
  maxResponseBytes?: number;
  acceptedStatuses?: number[];
  retrySafe?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

type WriterResponse = {
  status: number;
  bytes: Uint8Array;
};

export class OpenWebUiWriterError extends RagSyncRuntimeError {
  constructor(
    code: string,
    retryable: boolean,
    readonly remoteStatus?: number,
  ) {
    super(code, retryable, 'Open WebUI writer request failed');
    this.name = 'OpenWebUiWriterError';
  }
}

@Injectable()
export class OpenWebUiWriterService {
  constructor(
    private readonly outboundPolicy: AiOutboundUrlPolicyService,
    private readonly config: RagSyncRuntimeConfigService,
    @Optional() private readonly repo?: RagSyncAdminRepo,
    @Optional() private readonly environment?: EnvironmentService,
  ) {}

  async preflightTarget(
    target: {
      bindingId: string;
      workspaceId: string;
      spaceId: string;
      adapter: 'open-webui-knowledge-v1';
      baseUrl: string;
      knowledgeId: string;
      configVersion: number;
      targetVersion: number;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const timeoutSignal = AbortSignal.timeout(
      Math.min(this.config.processingTimeoutMs, TARGET_TEST_TIMEOUT_MS),
    );
    const preflightSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    await this.listKnowledgeFilesPage(
      {
        id: target.bindingId,
        workspaceId: target.workspaceId,
        spaceId: target.spaceId,
        state: 'enabled',
        adapter: target.adapter,
        baseUrl: target.baseUrl,
        knowledgeId: target.knowledgeId,
        configVersion: target.configVersion,
        targetVersion: target.targetVersion,
        updatedAtMs: Date.now(),
      },
      1,
      preflightSignal,
    );
  }

  async testTarget(
    target: {
      bindingId: string;
      workspaceId: string;
      spaceId: string;
      adapter: 'open-webui-knowledge-v1';
      baseUrl: string;
      knowledgeId: string;
      configVersion: number;
      targetVersion: number;
    },
    signal?: AbortSignal,
  ): Promise<{ ok: true; latencyMs: number }> {
    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(
      Math.min(this.config.processingTimeoutMs, TARGET_TEST_TIMEOUT_MS),
    );
    const testSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    await this.test(
      {
        id: target.bindingId,
        workspaceId: target.workspaceId,
        spaceId: target.spaceId,
        state: 'enabled',
        adapter: target.adapter,
        baseUrl: target.baseUrl,
        knowledgeId: target.knowledgeId,
        configVersion: target.configVersion,
        targetVersion: target.targetVersion,
        updatedAtMs: Date.now(),
      },
      testSignal,
    );
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  async upload(
    binding: RagSyncRuntimeBinding,
    input: {
      fileName: string;
      mimeType: string;
      content: Uint8Array;
      metadata: RagSyncDocmostMetadataV2;
    },
    signal?: AbortSignal,
  ): Promise<OpenWebUiFile> {
    throwIfAborted(signal);
    if (input.content.byteLength > this.config.maxAttachmentBytes) {
      throw new RagSyncRuntimeError(
        'rag_sync_source_too_large',
        false,
        'RAG synchronization source exceeds the configured size limit',
      );
    }
    const signedMetadata = {
      ...input.metadata,
      ownershipMac: this.createOwnershipMac(input.metadata),
    };
    const metadata = JSON.stringify({
      knowledge_id: binding.knowledgeId,
      file_hash: input.metadata.contentHash,
      docmost: signedMetadata,
    });
    const form = new FormData();
    form.set(
      'file',
      new Blob([input.content], { type: input.mimeType }),
      input.fileName,
    );
    form.set('metadata', metadata);

    const response = await this.requestJson<OpenWebUiFile>(
      binding,
      'api/v1/files/?process=true&process_in_background=true',
      {
        method: 'POST',
        body: form,
        requestBytes: input.content.byteLength + Buffer.byteLength(metadata),
        maxResponseBytes: 1024 * 1024,
        retrySafe: false,
        idempotencyKey: input.metadata.operationId,
        signal,
      },
    );
    throwIfAborted(signal);
    if (!response.id || !FILE_ID_PATTERN.test(response.id)) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    return response;
  }

  async waitUntilProcessed(
    binding: RagSyncRuntimeBinding,
    fileId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    this.assertFileId(fileId);
    const deadline = Date.now() + this.config.processingTimeoutMs;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const result = await this.requestJson<{ status?: unknown }>(
        binding,
        `api/v1/files/${encodeURIComponent(fileId)}/process/status`,
        { maxResponseBytes: 16 * 1024, retrySafe: true, signal },
      );
      throwIfAborted(signal);
      if (result.status === 'completed') return;
      if (result.status === 'failed' || result.status === 'not_found') {
        throw new OpenWebUiProcessingError(fileId, result.status);
      }
      await delay(1_000, signal);
    }
    throw new OpenWebUiProcessingError(fileId, 'timeout');
  }

  async deleteFile(
    binding: RagSyncRuntimeBinding,
    fileId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    this.assertFileId(fileId);
    await this.request(binding, `api/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      maxResponseBytes: 16 * 1024,
      acceptedStatuses: [404],
      retrySafe: true,
      signal,
    });
    throwIfAborted(signal);
  }

  async listKnowledgeFilesPage(
    binding: RagSyncRuntimeBinding,
    page: number,
    signal?: AbortSignal,
  ): Promise<{ items: OpenWebUiFile[]; total: number; hasMore: boolean }> {
    throwIfAborted(signal);
    this.assertKnowledgeId(binding.knowledgeId);
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    const response = await this.requestJson<unknown>(
      binding,
      `api/v1/knowledge/${encodeURIComponent(binding.knowledgeId)}/files?page=${page}&limit=${KNOWLEDGE_PAGE_SIZE}&include_content=false`,
      { maxResponseBytes: MAX_JSON_RESPONSE_BYTES, retrySafe: true, signal },
    );
    throwIfAborted(signal);
    if (!isRecord(response) || !Array.isArray(response.items)) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    const total = Number(response.total);
    const offset = (page - 1) * KNOWLEDGE_PAGE_SIZE;
    const expectedLength =
      offset > total ? 0 : Math.min(KNOWLEDGE_PAGE_SIZE, total - offset);
    if (
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total > MAX_KNOWLEDGE_SCAN_FILES ||
      response.items.length !== expectedLength
    ) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    const items = response.items.map((candidate) => {
      const file = projectOpenWebUiFile(candidate);
      if (!file) {
        throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
      }
      return file;
    });
    if (new Set(items.map((file) => file.id)).size !== items.length) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  async getFile(
    binding: RagSyncRuntimeBinding,
    fileId: string,
    signal?: AbortSignal,
  ): Promise<OpenWebUiFile | null> {
    this.assertFileId(fileId);
    const response = await this.request(
      binding,
      `api/v1/files/${encodeURIComponent(fileId)}`,
      {
        maxResponseBytes: 1024 * 1024,
        acceptedStatuses: [404],
        retrySafe: true,
        signal,
      },
    );
    if (response.status === 404) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(response.bytes));
    } catch {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    const file = projectOpenWebUiFile(parsed);
    if (!file || file.id !== fileId) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    return file;
  }

  async test(
    binding: RagSyncRuntimeBinding,
    signal?: AbortSignal,
  ): Promise<void> {
    const operationId = randomBytes(32).toString('hex');
    let fileId: string | undefined;
    await this.cleanupStaleTestMarkers(binding, signal);
    try {
      const uploaded = await this.upload(
        binding,
        {
          fileName: `docmost-rag-sync-test-${operationId}.md`,
          mimeType: 'text/markdown',
          content: new TextEncoder().encode('# Docmost RAG sync test'),
          metadata: {
            schemaVersion: 2,
            bindingId: binding.id,
            targetVersion: binding.targetVersion,
            workspaceId: binding.workspaceId,
            spaceId: binding.spaceId,
            sourceType: 'page',
            sourceId: binding.id,
            pageId: binding.id,
            sourceUpdatedAtMs: Date.now(),
            contentHash: operationId.replaceAll('-', ''),
            operationId,
            marker: 'target-test',
          },
        },
        signal,
      );
      fileId = uploaded.id;
      await this.waitUntilProcessed(binding, fileId, signal);
    } finally {
      if (fileId && !signal?.aborted) {
        await this.deleteFile(
          binding,
          fileId,
          AbortSignal.timeout(this.config.requestTimeoutMs),
        );
      }
    }
  }

  private async cleanupStaleTestMarkers(
    binding: RagSyncRuntimeBinding,
    signal?: AbortSignal,
  ): Promise<void> {
    let deleted = 0;
    for (let page = 1; page <= MAX_TARGET_TEST_SCAN_PAGES; page += 1) {
      const result = await this.listKnowledgeFilesPage(binding, page, signal);
      for (const file of result.items) {
        const ownership = this.readOwnership(file, binding);
        if (
          ownership?.schemaVersion !== 2 ||
          ownership.metadata.marker !== 'target-test' ||
          ownership.metadata.sourceUpdatedAtMs >
            Date.now() - TARGET_TEST_TIMEOUT_MS - this.config.requestTimeoutMs
        ) {
          continue;
        }
        await this.deleteFile(binding, file.id, signal);
        deleted += 1;
        if (deleted >= 20) return;
      }
      if (!result.hasMore) return;
    }
  }

  findOwnedFileByOperationId(
    files: OpenWebUiFile[],
    binding: RagSyncRuntimeBinding,
    operationId: string,
  ): OpenWebUiFile | undefined {
    return files.find((file) => {
      const ownership = this.readOwnership(file, binding);
      return (
        ownership?.schemaVersion === 2 &&
        ownership.metadata.operationId === operationId
      );
    });
  }

  readOwnership(
    file: OpenWebUiFile,
    binding: RagSyncRuntimeBinding,
  ): RagSyncRemoteOwnership | null {
    const candidate = nestedDocmost(file);
    if (
      !candidate ||
      candidate.workspaceId !== binding.workspaceId ||
      candidate.spaceId !== binding.spaceId ||
      !isSourceType(candidate.sourceType) ||
      typeof candidate.sourceId !== 'string' ||
      !isSourcePageId(candidate.sourceType, candidate.pageId) ||
      typeof candidate.contentHash !== 'string' ||
      !Number.isSafeInteger(candidate.sourceUpdatedAtMs) ||
      Number(candidate.sourceUpdatedAtMs) < 0
    ) {
      return null;
    }
    if (
      candidate.schemaVersion === 2 &&
      candidate.bindingId === binding.id &&
      Number.isSafeInteger(candidate.targetVersion) &&
      Number(candidate.targetVersion) >= 1 &&
      typeof candidate.operationId === 'string' &&
      /^[0-9a-f]{64}$/.test(candidate.operationId) &&
      typeof candidate.ownershipMac === 'string' &&
      /^[0-9a-f]{64}$/.test(candidate.ownershipMac) &&
      safeStringEqual(
        candidate.ownershipMac,
        this.createOwnershipMac(candidate as RagSyncDocmostMetadataV2),
      )
    ) {
      return {
        schemaVersion: 2,
        metadata: candidate as RagSyncDocmostMetadataV2,
      };
    }
    if (candidate.schemaVersion === 1) {
      return {
        schemaVersion: 1,
        metadata: candidate as RagSyncLegacyDocmostMetadata,
      };
    }
    return null;
  }

  private async requestJson<T>(
    binding: RagSyncRuntimeBinding,
    path: string,
    options: WriterRequest,
  ): Promise<T> {
    const response = await this.request(binding, path, options);
    try {
      return JSON.parse(new TextDecoder().decode(response.bytes)) as T;
    } catch {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
  }

  private createOwnershipMac(
    metadata: Omit<RagSyncDocmostMetadataV2, 'ownershipMac'>,
  ): string {
    if (!this.environment) {
      throw new OpenWebUiWriterError('rag_sync_writer_key_missing', false);
    }
    return createHmac('sha256', this.environment.getAppSecret())
      .update('docmost:rag-sync:ownership:v2\n', 'utf8')
      .update(
        JSON.stringify([
          metadata.schemaVersion,
          metadata.bindingId,
          metadata.targetVersion,
          metadata.workspaceId,
          metadata.spaceId,
          metadata.sourceType,
          metadata.sourceId,
          metadata.pageId,
          metadata.databaseId ?? null,
          metadata.sourceUpdatedAtMs,
          metadata.contentHash,
          metadata.operationId,
          metadata.marker ?? null,
        ]),
        'utf8',
      )
      .digest('hex');
  }

  private async request(
    binding: RagSyncRuntimeBinding,
    path: string,
    options: WriterRequest,
  ): Promise<WriterResponse> {
    throwIfAborted(options.signal);
    this.assertBinding(binding);
    if (
      (options.requestBytes ?? 0) >
      this.config.maxAttachmentBytes + 1024 * 1024
    ) {
      throw new RagSyncRuntimeError('rag_sync_source_too_large', false);
    }
    const target = this.endpoint(binding, path);
    const attempts = options.retrySafe ? 4 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      throwIfAborted(options.signal);
      try {
        const response = await this.performRequest(binding, target, options);
        throwIfAborted(options.signal);
        return response;
      } catch (error) {
        lastError = error;
        if (
          options.signal?.aborted ||
          !(error instanceof RagSyncRuntimeError) ||
          !error.retryable ||
          attempt === attempts - 1
        ) {
          throw error;
        }
        await delay(Math.min(5_000, 250 * 2 ** attempt), options.signal);
      }
    }
    throw lastError;
  }

  private async performRequest(
    binding: RagSyncRuntimeBinding,
    target: string,
    options: WriterRequest,
  ): Promise<WriterResponse> {
    throwIfAborted(options.signal);
    let resolved;
    try {
      resolved = await this.outboundPolicy.resolveAllowed(target, {
        kind: 'rag-sync',
        allowedOrigins: this.config.allowedOrigins,
        allowQuery: true,
        requireExplicitOrigin: true,
      });
      throwIfAborted(options.signal);
    } catch {
      throwIfAborted(options.signal);
      throw new OpenWebUiWriterError('rag_sync_url_rejected', false);
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error('RAG sync request timed out')),
      this.config.requestTimeoutMs,
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;
    const pinned = createAiPinnedDispatcher(resolved.addresses);
    try {
      throwIfAborted(options.signal);
      const writerApiKey = await this.resolveWriterApiKey(binding);
      throwIfAborted(options.signal);
      const response = await fetch(resolved.url, {
        method: options.method ?? 'GET',
        body: options.body,
        redirect: 'manual',
        signal,
        dispatcher: pinned.dispatcher,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${writerApiKey}`,
          ...(options.idempotencyKey
            ? { 'idempotency-key': options.idempotencyKey }
            : {}),
        },
      } as RequestInit & { dispatcher: Dispatcher });
      throwIfAborted(options.signal);
      const accepted = options.acceptedStatuses?.includes(response.status);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new OpenWebUiWriterError('rag_sync_redirect_rejected', false);
      }
      if (!response.ok && !accepted) {
        await response.body?.cancel();
        throw remoteError(response.status);
      }
      const bytes = await readBounded(
        response,
        options.maxResponseBytes ?? MAX_JSON_RESPONSE_BYTES,
      );
      throwIfAborted(options.signal);
      return { status: response.status, bytes };
    } catch (error) {
      if (options.signal?.aborted) {
        throw (
          options.signal.reason ?? new DOMException('Aborted', 'AbortError')
        );
      }
      if (timeoutController.signal.aborted) {
        throw new OpenWebUiWriterError('rag_sync_target_timeout', true);
      }
      if ((error as Error)?.name === 'AbortError') {
        throw new OpenWebUiWriterError('rag_sync_target_timeout', true);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      await pinned.close();
    }
  }

  private endpoint(binding: RagSyncRuntimeBinding, path: string): string {
    let base: URL;
    try {
      base = new URL(binding.baseUrl);
    } catch {
      throw new OpenWebUiWriterError('rag_sync_url_rejected', false);
    }
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    ) {
      throw new OpenWebUiWriterError('rag_sync_url_rejected', false);
    }
    const target = new URL(path.replace(/^\/+/, ''), `${base.origin}/`);
    if (target.origin !== base.origin) {
      throw new OpenWebUiWriterError('rag_sync_url_rejected', false);
    }
    return target.toString();
  }

  private assertBinding(binding: RagSyncRuntimeBinding): void {
    this.assertKnowledgeId(binding.knowledgeId);
  }

  private async resolveWriterApiKey(
    binding: RagSyncRuntimeBinding,
  ): Promise<string> {
    if (binding.writerApiKey?.trim()) return binding.writerApiKey;
    if (!this.repo || !this.environment) {
      throw new OpenWebUiWriterError('rag_sync_writer_key_missing', false);
    }
    const current = await this.repo.findById(binding.id);
    if (
      !current ||
      current.configVersion !== binding.configVersion ||
      current.targetVersion !== binding.targetVersion ||
      current.baseUrl !== binding.baseUrl ||
      current.knowledgeId !== binding.knowledgeId
    ) {
      throw new RagSyncRuntimeError('rag_sync_aborted', true);
    }
    if (!current.writerApiKeyEncrypted) {
      throw new OpenWebUiWriterError('rag_sync_writer_key_missing', false);
    }
    try {
      if (!isEncryptedProtectedValue(current.writerApiKeyEncrypted)) {
        throw new Error('Unencrypted writer key');
      }
      const writerApiKey = decryptProtectedValue(
        current.writerApiKeyEncrypted,
        this.environment.getAppSecret(),
      );
      if (!writerApiKey.trim()) throw new Error('Empty writer key');
      return writerApiKey;
    } catch {
      throw new OpenWebUiWriterError('rag_sync_writer_key_missing', false);
    }
  }

  private assertKnowledgeId(knowledgeId: string): void {
    if (!KNOWLEDGE_ID_PATTERN.test(knowledgeId)) {
      throw new OpenWebUiWriterError('rag_sync_target_invalid', false);
    }
  }

  private assertFileId(fileId: string): void {
    if (!FILE_ID_PATTERN.test(fileId)) {
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
  }
}

function remoteError(status: number): OpenWebUiWriterError {
  if (status === 401 || status === 403) {
    /**
     * A rejected credential is recoverable: an administrator rotates the writer
     * key and synchronization continues. Reporting it as terminal made the
     * supervisor disable the binding, so the space stopped syncing for good and
     * a later valid key changed nothing until someone re-enabled it by hand.
     * The binding stays enabled and degraded, retrying under the usual backoff.
     */
    return new OpenWebUiWriterError(
      'rag_sync_writer_unauthorized',
      true,
      status,
    );
  }
  if (status === 404) {
    return new OpenWebUiWriterError(
      'rag_sync_target_unavailable',
      false,
      status,
    );
  }
  return new OpenWebUiWriterError(
    'rag_sync_target_unavailable',
    status === 429 || status >= 500,
    status,
  );
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new OpenWebUiWriterError('rag_sync_invalid_response', false);
    }
    chunks.push(chunk.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function nestedDocmost(file: OpenWebUiFile): Record<string, unknown> | null {
  const nested = file.meta?.data?.docmost ?? file.meta?.docmost;
  return nested && typeof nested === 'object'
    ? (nested as Record<string, unknown>)
    : null;
}

function projectOpenWebUiFile(value: unknown): OpenWebUiFile | null {
  if (!isRecord(value) || !isBoundedString(value.id, 200)) return null;
  if (!FILE_ID_PATTERN.test(value.id)) return null;

  const file: OpenWebUiFile = { id: value.id };
  if (isBoundedString(value.filename, 512)) file.filename = value.filename;

  const rawMeta = isRecord(value.meta) ? value.meta : null;
  const rawData = rawMeta && isRecord(rawMeta.data) ? rawMeta.data : null;
  const rawDocmost = rawData?.docmost ?? rawMeta?.docmost;
  if (isRecord(rawDocmost)) {
    file.meta = { data: { docmost: projectDocmostMetadata(rawDocmost) } };
  }

  const rawFileData = isRecord(value.data) ? value.data : null;
  if (rawFileData && isBoundedString(rawFileData.status, 64)) {
    file.data = { status: rawFileData.status };
  }
  return file;
}

function projectDocmostMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, maxLength] of [
    ['bindingId', 200],
    ['workspaceId', 200],
    ['spaceId', 200],
    ['sourceType', 32],
    ['sourceId', 200],
    ['pageId', 200],
    ['databaseId', 200],
    ['contentHash', 128],
    ['operationId', 128],
    ['ownershipMac', 128],
    ['marker', 32],
  ] as const) {
    if (isBoundedString(value[name], maxLength)) result[name] = value[name];
  }
  for (const name of [
    'schemaVersion',
    'targetVersion',
    'sourceUpdatedAtMs',
  ] as const) {
    if (Number.isSafeInteger(value[name])) result[name] = value[name];
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isSourceType(value: unknown): boolean {
  return ['page', 'database_row', 'attachment', 'dictionary_term'].includes(
    String(value),
  );
}

function isSourcePageId(sourceType: unknown, pageId: unknown): boolean {
  return sourceType === 'dictionary_term'
    ? pageId === null
    : typeof pageId === 'string';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException('Aborted', 'AbortError'),
    );
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}
