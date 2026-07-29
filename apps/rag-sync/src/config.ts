import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type {
  RagSyncBinding,
  RagSyncBindingConfig,
  RagSyncConfig,
} from './types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWLEDGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export async function loadConfig(
  configPath: string,
): Promise<{ config: RagSyncConfig; bindings: RagSyncBinding[] }> {
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const configDirectory = resolve(configPath, '..');
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.bindings)) {
    throw new Error('RAG sync config must use schemaVersion 1 and bindings');
  }
  const config: RagSyncConfig = {
    schemaVersion: 1,
    redisUrl: requiredString(raw.redisUrl, 'redisUrl'),
    redisPrefix: optionalString(raw.redisPrefix) || 'docmost:rag-sync',
    pollIntervalMs: boundedNumber(
      raw.pollIntervalMs,
      60_000,
      5_000,
      3_600_000,
      'pollIntervalMs',
    ),
    requestTimeoutMs: boundedNumber(
      raw.requestTimeoutMs,
      30_000,
      1_000,
      600_000,
      'requestTimeoutMs',
    ),
    processingTimeoutMs: boundedNumber(
      raw.processingTimeoutMs,
      600_000,
      10_000,
      7_200_000,
      'processingTimeoutMs',
    ),
    maxAttachmentBytes: boundedNumber(
      raw.maxAttachmentBytes,
      25 * 1024 * 1024,
      1024,
      100 * 1024 * 1024,
      'maxAttachmentBytes',
    ),
    bindings: raw.bindings.map((value, index) =>
      parseBinding(value, index),
    ),
  };
  const ids = new Set<string>();
  const spaces = new Set<string>();
  for (const binding of config.bindings) {
    if (ids.has(binding.id) || spaces.has(binding.spaceId)) {
      throw new Error('RAG sync binding id and spaceId must be unique');
    }
    ids.add(binding.id);
    spaces.add(binding.spaceId);
  }

  const bindings = await Promise.all(
    config.bindings.map(async (binding) => ({
      ...binding,
      docmostApiKey: await readSecret(
        resolvePath(configDirectory, binding.docmostApiKeyFile),
      ),
      openWebUiApiKey: await readSecret(
        resolvePath(configDirectory, binding.openWebUiApiKeyFile),
      ),
    })),
  );
  return { config, bindings };
}

function parseBinding(value: unknown, index: number): RagSyncBindingConfig {
  if (!value || typeof value !== 'object') {
    throw new Error(`bindings[${index}] must be an object`);
  }
  const binding = value as Record<string, unknown>;
  if (
    'docmostApiKey' in binding ||
    'openWebUiApiKey' in binding
  ) {
    throw new Error(
      `bindings[${index}] must reference API key files, not inline keys`,
    );
  }
  const workspaceId = requiredString(
    binding.workspaceId,
    `bindings[${index}].workspaceId`,
  );
  const spaceId = requiredString(
    binding.spaceId,
    `bindings[${index}].spaceId`,
  );
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(spaceId)) {
    throw new Error(`bindings[${index}] workspaceId and spaceId must be UUIDs`);
  }
  const knowledgeId = requiredString(
    binding.knowledgeId,
    `bindings[${index}].knowledgeId`,
  );
  if (!KNOWLEDGE_ID_PATTERN.test(knowledgeId)) {
    throw new Error(`bindings[${index}].knowledgeId is invalid`);
  }
  return {
    id: requiredString(binding.id, `bindings[${index}].id`),
    workspaceId,
    spaceId,
    docmostBaseUrl: normalizeBaseUrl(
      requiredString(
        binding.docmostBaseUrl,
        `bindings[${index}].docmostBaseUrl`,
      ),
    ),
    docmostApiKeyFile: requiredString(
      binding.docmostApiKeyFile,
      `bindings[${index}].docmostApiKeyFile`,
    ),
    openWebUiBaseUrl: normalizeBaseUrl(
      requiredString(
        binding.openWebUiBaseUrl,
        `bindings[${index}].openWebUiBaseUrl`,
      ),
    ),
    openWebUiApiKeyFile: requiredString(
      binding.openWebUiApiKeyFile,
      `bindings[${index}].openWebUiApiKeyFile`,
    ),
    knowledgeId,
  };
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Base URLs must be credential-free HTTP(S) origins');
  }
  return url.origin;
}

async function readSecret(filePath: string): Promise<string> {
  const value = (await readFile(filePath, 'utf8')).trim();
  if (!value) {
    throw new Error('RAG sync secret file is empty');
  }
  return value;
}

function resolvePath(base: string, value: string): string {
  return isAbsolute(value) ? value : resolve(base, value);
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
