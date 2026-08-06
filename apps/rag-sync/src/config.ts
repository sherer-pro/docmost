import type { RagSyncBinding, RagSyncConfig } from './types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWLEDGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): { config: RagSyncConfig; bindings: RagSyncBinding[] } {
  const workspaceId = requiredString(
    environment.RAG_SYNC_WORKSPACE_ID,
    'RAG_SYNC_WORKSPACE_ID',
  );
  const spaceId = requiredString(
    environment.RAG_SYNC_SPACE_ID,
    'RAG_SYNC_SPACE_ID',
  );
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(spaceId)) {
    throw new Error(
      'RAG_SYNC_WORKSPACE_ID and RAG_SYNC_SPACE_ID must be UUIDs',
    );
  }

  const knowledgeId = requiredString(
    environment.RAG_SYNC_KNOWLEDGE_ID,
    'RAG_SYNC_KNOWLEDGE_ID',
  );
  if (!KNOWLEDGE_ID_PATTERN.test(knowledgeId)) {
    throw new Error('RAG_SYNC_KNOWLEDGE_ID is invalid');
  }

  const binding: RagSyncBinding = {
    id: requiredString(
      environment.RAG_SYNC_BINDING_ID,
      'RAG_SYNC_BINDING_ID',
    ),
    workspaceId,
    spaceId,
    docmostBaseUrl: normalizeBaseUrl(
      requiredString(
        environment.RAG_SYNC_DOCMOST_BASE_URL,
        'RAG_SYNC_DOCMOST_BASE_URL',
      ),
      'RAG_SYNC_DOCMOST_BASE_URL',
    ),
    docmostApiKey: requiredString(
      environment.RAG_SYNC_DOCMOST_API_KEY,
      'RAG_SYNC_DOCMOST_API_KEY',
    ),
    openWebUiBaseUrl: normalizeBaseUrl(
      requiredString(
        environment.RAG_SYNC_OPEN_WEBUI_BASE_URL,
        'RAG_SYNC_OPEN_WEBUI_BASE_URL',
      ),
      'RAG_SYNC_OPEN_WEBUI_BASE_URL',
    ),
    openWebUiApiKey: requiredString(
      environment.RAG_SYNC_OPEN_WEBUI_API_KEY,
      'RAG_SYNC_OPEN_WEBUI_API_KEY',
    ),
    knowledgeId,
  };

  const config: RagSyncConfig = {
    redisUrl: requiredString(
      environment.RAG_SYNC_REDIS_URL,
      'RAG_SYNC_REDIS_URL',
    ),
    redisPrefix:
      optionalString(environment.RAG_SYNC_REDIS_PREFIX) || 'docmost:rag-sync',
    pollIntervalMs: boundedNumber(
      environment.RAG_SYNC_POLL_INTERVAL_MS,
      60_000,
      5_000,
      3_600_000,
      'RAG_SYNC_POLL_INTERVAL_MS',
    ),
    requestTimeoutMs: boundedNumber(
      environment.RAG_SYNC_REQUEST_TIMEOUT_MS,
      30_000,
      1_000,
      600_000,
      'RAG_SYNC_REQUEST_TIMEOUT_MS',
    ),
    processingTimeoutMs: boundedNumber(
      environment.RAG_SYNC_PROCESSING_TIMEOUT_MS,
      600_000,
      10_000,
      7_200_000,
      'RAG_SYNC_PROCESSING_TIMEOUT_MS',
    ),
    maxAttachmentBytes: boundedNumber(
      environment.RAG_SYNC_MAX_ATTACHMENT_BYTES,
      25 * 1024 * 1024,
      1024,
      100 * 1024 * 1024,
      'RAG_SYNC_MAX_ATTACHMENT_BYTES',
    ),
    bindings: [binding],
  };

  return { config, bindings: config.bindings };
}

function normalizeBaseUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`${name} must be a credential-free HTTP(S) origin`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return result;
}
