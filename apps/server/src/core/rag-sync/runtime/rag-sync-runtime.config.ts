import { Injectable } from '@nestjs/common';

export interface RagSyncRuntimeConfig {
  enabled: boolean;
  allowedOrigins: string;
  pollIntervalMs: number;
  discoveryIntervalMs: number;
  maxConcurrentBindings: number;
  maxConcurrentDocuments: number;
  requestTimeoutMs: number;
  processingTimeoutMs: number;
  maxAttachmentBytes: number;
  reconcileIntervalMs: number;
  shutdownTimeoutMs: number;
  redisPrefix: string;
  leaseTtlMs: number;
}

export function loadRagSyncRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RagSyncRuntimeConfig {
  const pollIntervalMs = boundedInteger(
    environment.RAG_SYNC_POLL_INTERVAL_MS,
    60_000,
    5_000,
    3_600_000,
    'RAG_SYNC_POLL_INTERVAL_MS',
  );
  const redisPrefix =
    optionalString(environment.RAG_SYNC_REDIS_PREFIX) ?? 'docmost:rag-sync';
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(redisPrefix)) {
    throw new Error(
      'RAG_SYNC_REDIS_PREFIX must contain only letters, digits, colon, underscore, or hyphen',
    );
  }

  return {
    enabled: booleanValue(
      environment.RAG_SYNC_ENABLED,
      false,
      'RAG_SYNC_ENABLED',
    ),
    allowedOrigins: optionalString(environment.RAG_SYNC_ALLOWED_ORIGINS) ?? '',
    pollIntervalMs,
    discoveryIntervalMs: boundedInteger(
      environment.RAG_SYNC_DISCOVERY_INTERVAL_MS,
      30_000,
      5_000,
      3_600_000,
      'RAG_SYNC_DISCOVERY_INTERVAL_MS',
    ),
    maxConcurrentBindings: boundedInteger(
      environment.RAG_SYNC_MAX_CONCURRENT_BINDINGS,
      4,
      1,
      64,
      'RAG_SYNC_MAX_CONCURRENT_BINDINGS',
    ),
    maxConcurrentDocuments: boundedInteger(
      environment.RAG_SYNC_MAX_CONCURRENT_DOCUMENTS,
      4,
      1,
      64,
      'RAG_SYNC_MAX_CONCURRENT_DOCUMENTS',
    ),
    requestTimeoutMs: boundedInteger(
      environment.RAG_SYNC_REQUEST_TIMEOUT_MS,
      30_000,
      1_000,
      600_000,
      'RAG_SYNC_REQUEST_TIMEOUT_MS',
    ),
    processingTimeoutMs: boundedInteger(
      environment.RAG_SYNC_PROCESSING_TIMEOUT_MS,
      600_000,
      10_000,
      7_200_000,
      'RAG_SYNC_PROCESSING_TIMEOUT_MS',
    ),
    maxAttachmentBytes: boundedInteger(
      environment.RAG_SYNC_MAX_ATTACHMENT_BYTES,
      25 * 1024 * 1024,
      1_024,
      100 * 1024 * 1024,
      'RAG_SYNC_MAX_ATTACHMENT_BYTES',
    ),
    reconcileIntervalMs: boundedInteger(
      environment.RAG_SYNC_RECONCILE_INTERVAL_MS,
      6 * 60 * 60_000,
      60_000,
      7 * 24 * 60 * 60_000,
      'RAG_SYNC_RECONCILE_INTERVAL_MS',
    ),
    shutdownTimeoutMs: boundedInteger(
      environment.RAG_SYNC_SHUTDOWN_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'RAG_SYNC_SHUTDOWN_TIMEOUT_MS',
    ),
    redisPrefix,
    leaseTtlMs: Math.max(30_000, Math.min(300_000, pollIntervalMs * 3)),
  };
}

@Injectable()
export class RagSyncRuntimeConfigService implements RagSyncRuntimeConfig {
  readonly enabled: boolean;
  readonly allowedOrigins: string;
  readonly pollIntervalMs: number;
  readonly discoveryIntervalMs: number;
  readonly maxConcurrentBindings: number;
  readonly maxConcurrentDocuments: number;
  readonly requestTimeoutMs: number;
  readonly processingTimeoutMs: number;
  readonly maxAttachmentBytes: number;
  readonly reconcileIntervalMs: number;
  readonly shutdownTimeoutMs: number;
  readonly redisPrefix: string;
  readonly leaseTtlMs: number;

  constructor() {
    Object.assign(this, loadRagSyncRuntimeConfig());
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanValue(
  value: unknown,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return result;
}
