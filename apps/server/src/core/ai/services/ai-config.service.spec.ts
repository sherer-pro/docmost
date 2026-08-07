import { AiConfigService } from './ai-config.service';

describe('AiConfigService secret handling', () => {
  const appSecret = '0123456789abcdef0123456789abcdef';
  const createService = () =>
    new AiConfigService(
      {} as any,
      { getAppSecret: () => appSecret } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('encrypts secrets and clears them only when explicitly requested', () => {
    const service = createService() as any;
    const encrypted = service.updateEncryptedSecret({
      existing: null,
      next: 'provider-secret',
      clear: false,
    });

    expect(encrypted).not.toContain('provider-secret');
    expect(service.decryptSecret(encrypted)).toBe('provider-secret');
    expect(
      service.updateEncryptedSecret({
        existing: encrypted,
        clear: true,
      }),
    ).toBeNull();
  });

  it('redacts encrypted values from the public configuration', () => {
    const service = createService() as any;
    const now = new Date();
    const publicConfig = service.toPublicConfig({
      id: 'config-id',
      workspaceId: 'workspace-id',
      spaceId: 'space-id',
      enabled: true,
      assistantNameEnabled: true,
      assistantName: 'Алиса',
      assistantGender: 'feminine',
      provider: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      chatModel: 'model',
      apiKeyEncrypted: 'encrypted-provider-secret',
      retrievalAdapter: 'http-json-v1',
      retrievalUrl: 'https://retrieval.example/query',
      retrievalApiKeyEncrypted: 'encrypted-retrieval-secret',
      retrievalOpenWebuiBaseUrl: 'https://open-webui.example',
      retrievalOpenWebuiApiKeyEncrypted:
        'encrypted-open-webui-retrieval-secret',
      retrievalOpenWebuiKnowledgeId: 'knowledge-1',
      retrievalTimeoutMs: 8000,
      retrievalMaxResults: 8,
      systemInstructions: null,
      temperature: 0.2,
      maxOutputTokens: 1000,
      contextWindow: 32000,
      requestTimeoutMs: 30000,
      dailyRequestLimitPerUser: 100,
      dailyTokenLimitPerSpace: 100000,
      retentionDays: 90,
      visionEnabled: false,
      reasoningEnabled: true,
      quickCommands: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(publicConfig.apiKeyConfigured).toBe(true);
    expect(publicConfig).toMatchObject({
      assistantNameEnabled: true,
      assistantName: 'Алиса',
      assistantGender: 'feminine',
    });
    expect(publicConfig.reasoningEnabled).toBe(true);
    expect(publicConfig.retrieval.apiKeyConfigured).toBe(true);
    expect(publicConfig.retrieval.openWebUi).toEqual({
      baseUrl: 'https://open-webui.example',
      knowledgeId: 'knowledge-1',
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(publicConfig)).not.toContain(
      'encrypted-provider-secret',
    );
    expect(JSON.stringify(publicConfig)).not.toContain(
      'encrypted-retrieval-secret',
    );
    expect(JSON.stringify(publicConfig)).not.toContain(
      'encrypted-open-webui-retrieval-secret',
    );
  });

  it('honors explicit provider and retrieval key clearing in connection tests', async () => {
    const service = createService() as any;
    service.urlPolicy = {
      assertAllowed: jest.fn(async (value: string) => new URL(value)),
    };
    service.retrievalUrlPolicy = {
      assertAllowed: jest.fn(async (value: string) => new URL(value)),
      assertBaseAllowed: jest.fn(async (value: string) => new URL(value)),
    };
    const providerSecret = service.updateEncryptedSecret({
      next: 'provider-secret',
    });
    const retrievalSecret = service.updateEncryptedSecret({
      next: 'retrieval-secret',
    });
    const openWebUiSecret = service.updateEncryptedSecret({
      next: 'open-webui-secret',
    });
    const existing = {
      baseUrl: 'https://provider.example/v1',
      chatModel: 'model',
      apiKeyEncrypted: providerSecret,
      retrievalAdapter: 'http-json-v1',
      retrievalUrl: 'https://retrieval.example/query',
      retrievalApiKeyEncrypted: retrievalSecret,
      retrievalOpenWebuiBaseUrl: 'https://open-webui.example',
      retrievalOpenWebuiApiKeyEncrypted: openWebUiSecret,
      retrievalOpenWebuiKnowledgeId: 'knowledge-1',
      retrievalTimeoutMs: 8000,
      retrievalMaxResults: 8,
    };

    await expect(
      service.mergeProviderConfig(existing, { clearApiKey: true }),
    ).resolves.toMatchObject({ apiKey: null });
    await expect(
      service.mergeRetrievalConfig(existing, {
        retrieval: { clearApiKey: true },
      }),
    ).resolves.toMatchObject({ apiKey: null });
    await expect(
      service.mergeRetrievalConfig(existing, {
        retrieval: {
          adapter: 'open-webui-knowledge-v1',
          openWebUi: { clearApiKey: true },
        },
      }),
    ).resolves.toMatchObject({
      adapter: 'open-webui-knowledge-v1',
      apiKey: 'retrieval-secret',
      openWebUiApiKey: null,
    });
  });

  it('keeps inactive adapter settings without revalidating their URLs', async () => {
    const service = createService() as any;
    service.retrievalUrlPolicy = {
      assertAllowed: jest.fn(async (value: string) => new URL(value)),
      assertBaseAllowed: jest.fn(async (value: string) => new URL(value)),
    };
    const existing = {
      retrievalAdapter: 'http-json-v1',
      retrievalUrl: 'https://legacy-retrieval.example/query',
      retrievalApiKeyEncrypted: service.updateEncryptedSecret({
        next: 'legacy-key',
      }),
      retrievalOpenWebuiBaseUrl: 'https://open-webui.example',
      retrievalOpenWebuiApiKeyEncrypted: service.updateEncryptedSecret({
        next: 'open-webui-key',
      }),
      retrievalOpenWebuiKnowledgeId: 'knowledge-1',
      retrievalTimeoutMs: 8000,
      retrievalMaxResults: 8,
    };

    await expect(
      service.mergeRetrievalConfig(existing, {
        retrieval: { adapter: 'open-webui-knowledge-v1' },
      }),
    ).resolves.toMatchObject({
      adapter: 'open-webui-knowledge-v1',
      url: 'https://legacy-retrieval.example/query',
      apiKey: 'legacy-key',
      openWebUiBaseUrl: 'https://open-webui.example',
      openWebUiKnowledgeId: 'knowledge-1',
      openWebUiApiKey: 'open-webui-key',
    });
    expect(service.retrievalUrlPolicy.assertAllowed).not.toHaveBeenCalled();
  });

  it('trims assistant names and preserves them while naming is disabled', () => {
    const service = createService() as any;
    const existing = {
      assistantNameEnabled: true,
      assistantName: 'Алиса',
      assistantGender: 'feminine',
    };

    expect(
      service.resolveAssistantIdentityUpdate(existing, {
        assistantNameEnabled: false,
      }),
    ).toEqual({
      assistantNameEnabled: false,
      assistantName: 'Алиса',
      assistantGender: 'feminine',
    });
    expect(
      service.resolveAssistantIdentityUpdate(existing, {
        assistantNameEnabled: true,
        assistantName: '  Макс 🤖  ',
        assistantGender: 'masculine',
      }),
    ).toEqual({
      assistantNameEnabled: true,
      assistantName: 'Макс 🤖',
      assistantGender: 'masculine',
    });
  });

  it('requires an effective name when custom naming is enabled', () => {
    const service = createService() as any;

    expect(() =>
      service.resolveAssistantIdentityUpdate(undefined, {
        assistantNameEnabled: true,
        assistantName: '   ',
      }),
    ).toThrow('assistantName is required');
    expect(() =>
      service.resolveAssistantIdentityUpdate(undefined, {
        assistantNameEnabled: true,
        assistantName: null,
      }),
    ).toThrow('assistantName is required');
  });

  it('returns only an active masculine or feminine identity', () => {
    const service = createService();

    expect(
      service.toAssistantIdentity({
        assistantNameEnabled: true,
        assistantName: '  Алиса  ',
        assistantGender: 'feminine',
      } as any),
    ).toEqual({ name: 'Алиса', gender: 'feminine' });
    expect(
      service.toAssistantIdentity({
        assistantNameEnabled: false,
        assistantName: 'Макс',
        assistantGender: 'masculine',
      } as any),
    ).toBeNull();
  });
});

describe('AiConfigService availability', () => {
  const workspace = { id: 'workspace-id' } as any;
  const owner = {
    id: 'owner-id',
    workspaceId: workspace.id,
    role: 'owner',
  } as any;
  const config = {
    id: 'config-id',
    workspaceId: workspace.id,
    spaceId: 'space-id',
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'https://provider.example/v1',
    chatModel: 'model',
    apiKeyEncrypted: null,
    retrievalAdapter: 'none',
    retrievalUrl: null,
    retrievalApiKeyEncrypted: null,
    retrievalTimeoutMs: 8000,
    retrievalMaxResults: 8,
    assistantNameEnabled: true,
    assistantName: 'Алиса',
    assistantGender: 'feminine',
    quickCommands: null,
  } as any;

  function createStatusService(
    page: any,
    options: { canManage?: boolean; config?: any } = {},
  ) {
    const usageResults = [
      { requests: 1, tokens: 25 },
      { requests: 8, tokens: 240 },
      { count: 0 },
    ];
    const db = {
      selectFrom: jest.fn(() => {
        const query: any = {
          select: jest.fn(() => query),
          where: jest.fn(() => query),
          executeTakeFirstOrThrow: jest
            .fn()
            .mockResolvedValue(usageResults.shift()),
        };
        return query;
      }),
    };
    const spaceAbility = {
      assertHasFullSpaceAccess:
        options.canManage === false
          ? jest.fn().mockRejectedValue(new Error('forbidden'))
          : jest.fn().mockResolvedValue(undefined),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue(page),
    };
    const pageAccess = {
      getEffectiveAccess: jest.fn().mockResolvedValue({
        capabilities: { canWrite: true },
      }),
    };
    const service = new AiConfigService(
      db as any,
      { getAppSecret: () => '0123456789abcdef0123456789abcdef' } as any,
      spaceAbility as any,
      pageRepo as any,
      pageAccess as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { isPageExcluded: jest.fn().mockResolvedValue(false) } as any,
      { getAvailability: jest.fn().mockResolvedValue(null) } as any,
    );
    jest
      .spyOn(service, 'getRawConfig')
      .mockResolvedValue(options.config ?? config);
    return { service, pageAccess };
  }

  it('allows a workspace owner to use AI on an active writable page', async () => {
    const { service } = createStatusService({
      id: 'page-id',
      workspaceId: workspace.id,
      spaceId: config.spaceId,
      deletedAt: null,
    });

    const status = await service.getStatus(
      config.spaceId,
      'page-id',
      owner,
      workspace,
    );

    expect(status).toMatchObject({
      canManage: true,
      canUse: true,
      usage: {
        requestsToday: 1,
        tokensToday: 25,
        requestsLast7Days: 8,
        tokensLast7Days: 240,
        activeRuns: 0,
      },
      assistantIdentity: {
        name: 'Алиса',
        gender: 'feminine',
      },
    });
    expect(status).not.toHaveProperty('unavailableReason');
  });

  it('explains a stale deleted-page URL to an administrator', async () => {
    const { service, pageAccess } = createStatusService({
      id: 'page-id',
      workspaceId: workspace.id,
      spaceId: config.spaceId,
      deletedAt: new Date(),
    });

    await expect(
      service.getStatus(config.spaceId, 'page-id', owner, workspace),
    ).resolves.toMatchObject({
      canManage: true,
      canUse: false,
      unavailableReason: 'page_unavailable',
    });
    expect(pageAccess.getEffectiveAccess).not.toHaveBeenCalled();
  });

  it('exposes an active identity to a member while AI is disabled', async () => {
    const member = {
      id: 'member-id',
      workspaceId: workspace.id,
      role: 'member',
    } as any;
    const { service } = createStatusService(
      {
        id: 'page-id',
        workspaceId: workspace.id,
        spaceId: config.spaceId,
        deletedAt: null,
      },
      {
        canManage: false,
        config: { ...config, enabled: false },
      },
    );

    await expect(
      service.getStatus(config.spaceId, 'page-id', member, workspace),
    ).resolves.toMatchObject({
      canManage: false,
      canUse: false,
      unavailableReason: 'disabled',
      assistantIdentity: {
        name: 'Алиса',
        gender: 'feminine',
      },
    });
  });
});
