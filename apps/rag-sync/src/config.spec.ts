import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from './config.js';

const validEnvironment: NodeJS.ProcessEnv = {
  RAG_SYNC_REDIS_URL: 'redis://localhost:6379/1',
  RAG_SYNC_BINDING_ID: 'space-a',
  RAG_SYNC_WORKSPACE_ID: '0198f2f5-a5a3-7000-8000-000000000001',
  RAG_SYNC_SPACE_ID: '0198f2f5-a5a3-7000-8000-000000000002',
  RAG_SYNC_DOCMOST_BASE_URL: 'https://docmost.example',
  RAG_SYNC_DOCMOST_API_KEY: 'docmost-secret',
  RAG_SYNC_OPEN_WEBUI_BASE_URL: 'https://open-webui.example',
  RAG_SYNC_OPEN_WEBUI_API_KEY: 'writer-secret',
  RAG_SYNC_KNOWLEDGE_ID: 'knowledge-1',
};

describe('loadConfig', () => {
  it('loads one binding and defaults from environment variables', () => {
    const result = loadConfig(validEnvironment);

    assert.equal(result.bindings[0]?.docmostApiKey, 'docmost-secret');
    assert.equal(result.bindings[0]?.openWebUiApiKey, 'writer-secret');
    assert.equal(result.config.redisPrefix, 'docmost:rag-sync');
    assert.equal(result.config.pollIntervalMs, 60_000);
    assert.equal(result.config.requestTimeoutMs, 30_000);
    assert.equal(result.config.processingTimeoutMs, 600_000);
    assert.equal(result.config.maxAttachmentBytes, 25 * 1024 * 1024);
  });

  it('loads explicit tuning values', () => {
    const result = loadConfig({
      ...validEnvironment,
      RAG_SYNC_REDIS_PREFIX: 'custom:sync',
      RAG_SYNC_POLL_INTERVAL_MS: '5000',
      RAG_SYNC_REQUEST_TIMEOUT_MS: '1000',
      RAG_SYNC_PROCESSING_TIMEOUT_MS: '10000',
      RAG_SYNC_MAX_ATTACHMENT_BYTES: '1024',
    });

    assert.equal(result.config.redisPrefix, 'custom:sync');
    assert.equal(result.config.pollIntervalMs, 5_000);
    assert.equal(result.config.requestTimeoutMs, 1_000);
    assert.equal(result.config.processingTimeoutMs, 10_000);
    assert.equal(result.config.maxAttachmentBytes, 1_024);
  });

  it('rejects missing variables without including secret values', () => {
    assert.throws(
      () =>
        loadConfig({
          ...validEnvironment,
          RAG_SYNC_DOCMOST_API_KEY: '',
        }),
      /RAG_SYNC_DOCMOST_API_KEY is required/,
    );
  });

  it('rejects invalid identifiers and non-origin URLs', () => {
    assert.throws(
      () =>
        loadConfig({
          ...validEnvironment,
          RAG_SYNC_SPACE_ID: 'not-a-uuid',
        }),
      /must be UUIDs/,
    );
    assert.throws(
      () =>
        loadConfig({
          ...validEnvironment,
          RAG_SYNC_KNOWLEDGE_ID: 'invalid/id',
        }),
      /RAG_SYNC_KNOWLEDGE_ID is invalid/,
    );
    assert.throws(
      () =>
        loadConfig({
          ...validEnvironment,
          RAG_SYNC_OPEN_WEBUI_BASE_URL: 'https://open-webui.example/api',
        }),
      /RAG_SYNC_OPEN_WEBUI_BASE_URL must be a credential-free HTTP\(S\) origin/,
    );
  });

  it('rejects out-of-range integer settings', () => {
    assert.throws(
      () =>
        loadConfig({
          ...validEnvironment,
          RAG_SYNC_POLL_INTERVAL_MS: '4999',
        }),
      /RAG_SYNC_POLL_INTERVAL_MS must be an integer between 5000 and 3600000/,
    );
  });
});
