import { loadRagSyncRuntimeConfig } from './rag-sync-runtime.config';

describe('loadRagSyncRuntimeConfig', () => {
  it('uses safe disabled defaults without per-space credentials', () => {
    const config = loadRagSyncRuntimeConfig({});

    expect(config).toMatchObject({
      enabled: false,
      allowedOrigins: '',
      pollIntervalMs: 60_000,
      discoveryIntervalMs: 30_000,
      maxConcurrentBindings: 4,
      maxConcurrentDocuments: 4,
      redisPrefix: 'docmost:rag-sync',
    });
    expect(config).not.toHaveProperty('workspaceId');
    expect(config).not.toHaveProperty('spaceId');
    expect(config).not.toHaveProperty('apiKey');
  });

  it('parses supported deployment controls', () => {
    const config = loadRagSyncRuntimeConfig({
      RAG_SYNC_ENABLED: 'true',
      RAG_SYNC_ALLOWED_ORIGINS: ' https://open-webui.example.test ',
      RAG_SYNC_POLL_INTERVAL_MS: '5000',
      RAG_SYNC_MAX_CONCURRENT_BINDINGS: '7',
      RAG_SYNC_MAX_CONCURRENT_DOCUMENTS: '3',
      RAG_SYNC_REDIS_PREFIX: 'custom:rag_sync',
    });

    expect(config.enabled).toBe(true);
    expect(config.allowedOrigins).toBe('https://open-webui.example.test');
    expect(config.maxConcurrentBindings).toBe(7);
    expect(config.maxConcurrentDocuments).toBe(3);
    expect(config.redisPrefix).toBe('custom:rag_sync');
    expect(config.leaseTtlMs).toBe(30_000);
  });

  it('rejects ambiguous booleans and unsafe Redis prefixes', () => {
    expect(() => loadRagSyncRuntimeConfig({ RAG_SYNC_ENABLED: 'yes' })).toThrow(
      'RAG_SYNC_ENABLED must be true or false',
    );
    expect(() =>
      loadRagSyncRuntimeConfig({ RAG_SYNC_REDIS_PREFIX: 'prefix with space' }),
    ).toThrow('RAG_SYNC_REDIS_PREFIX');
  });
});
