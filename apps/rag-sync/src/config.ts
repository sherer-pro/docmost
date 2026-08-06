import type { RagSyncBindingConfig, RagSyncConfig } from './types.js';

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): { config: RagSyncConfig; bindings: RagSyncBindingConfig[] } {
  const binding: RagSyncBindingConfig = {
    id: requiredString(
      environment.RAG_SYNC_BINDING_ID,
      'RAG_SYNC_BINDING_ID',
    ),
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
    openWebUiApiKey: requiredString(
      environment.RAG_SYNC_OPEN_WEBUI_API_KEY,
      'RAG_SYNC_OPEN_WEBUI_API_KEY',
    ),
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
