import type { AiAssistantProfileSnapshot } from '@docmost/api-contract';

jest.mock('../mcp/ai-mcp-policy.service', () => ({
  AiMcpPolicyService: class AiMcpPolicyService {},
}));
jest.mock('../tools/ai-builtin-tool-policy.service', () => ({
  AiBuiltinToolPolicyService: class AiBuiltinToolPolicyService {},
}));

import { AiAssistantProfileService } from './ai-assistant-profile.service';

describe('AiAssistantProfileService snapshots', () => {
  const config = {
    workspaceId: 'workspace',
    spaceId: 'space',
    baseUrl: 'https://provider.example/v1/',
    chatModel: 'space-model',
    temperature: 0.4,
    maxOutputTokens: 4096,
    contextWindow: 32_768,
    requestTimeoutMs: 60_000,
    visionEnabled: true,
    reasoningEnabled: false,
  } as any;

  function snapshot(
    overrides: Partial<AiAssistantProfileSnapshot> = {},
  ): AiAssistantProfileSnapshot {
    return {
      schemaVersion: 1,
      source: 'assistant_profile',
      profileId: 'profile',
      profileVersion: 3,
      display: { name: 'Reviewer', description: null, icon: 'sparkles' },
      instructions: 'Review carefully.',
      quickCommands: null,
      chatModelOverride: null,
      temperatureOverride: null,
      maxOutputTokensOverride: null,
      allowedBuiltinCapabilities: ['search.query'],
      allowedExternalTools: [],
      autoStart: false,
      launchMessage: null,
      toolPolicyFingerprint: 'policy',
      ...overrides,
    };
  }

  function service() {
    return new AiAssistantProfileService(
      {} as any,
      {} as any,
      {} as any,
      {
        toProviderConfig: jest.fn((value) => ({
          ...value,
          apiKey: 'current-secret',
        })),
      } as any,
      {
        getEffectiveCapabilities: jest
          .fn()
          .mockResolvedValue(['search.query']),
      } as any,
      {} as any,
      {} as any,
      { observeProfileOutcome: jest.fn() } as any,
    );
  }

  it('creates a non-secret provider snapshot and clamps output tokens', () => {
    const result = service().buildProviderSnapshot(
      config,
      snapshot({
        chatModelOverride: 'profile-model',
        temperatureOverride: 1.2,
        maxOutputTokensOverride: 8192,
      }),
    );

    expect(result).toEqual({
      schemaVersion: 1,
      providerProtocolVersion: 'openai-compatible:v1',
      normalizedBaseUrl: 'https://provider.example/v1',
      chatModel: 'profile-model',
      temperature: 1.2,
      maxOutputTokens: 4096,
      contextWindow: 32_768,
      requestTimeoutMs: 60_000,
      visionEnabled: true,
      reasoningEnabled: false,
    });
    expect(result).not.toHaveProperty('apiKey');
  });

  it('does not accept default-model verification for a model override', () => {
    const profiles = service();
    const defaultProvider = profiles.buildProviderSnapshot(config, snapshot());
    const overrideProvider = profiles.buildProviderSnapshot(
      config,
      snapshot({ chatModelOverride: 'profile-model' }),
    );

    expect(profiles.effectiveProviderFingerprint(defaultProvider)).not.toBe(
      profiles.effectiveProviderFingerprint(overrideProvider),
    );
  });

  it('rejects a profile snapshot whose fingerprint no longer matches', () => {
    const profiles = service();
    const frozen = snapshot();
    const fingerprint = profiles.snapshotFingerprint(frozen);

    expect(profiles.readSnapshot(frozen, fingerprint)).toEqual(frozen);
    expect(
      profiles.readSnapshot(
        { ...frozen, instructions: 'Changed after freezing.' },
        fingerprint,
      ),
    ).toBeNull();
  });

  it('uses the current credential only when the provider origin is unchanged', () => {
    const profiles = service();
    const providerSnapshot = profiles.buildProviderSnapshot(
      config,
      snapshot({ chatModelOverride: 'profile-model' }),
    );
    const run = {
      providerConfigSnapshot: providerSnapshot,
      providerConfigFingerprint:
        profiles.providerSnapshotFingerprint(providerSnapshot),
    } as any;

    expect(profiles.providerConfigForRun(run, config)).toMatchObject({
      apiKey: 'current-secret',
      baseUrl: 'https://provider.example/v1',
      chatModel: 'profile-model',
    });
    expect(() =>
      profiles.providerConfigForRun(run, {
        ...config,
        baseUrl: 'https://replacement.example/v1',
      }),
    ).toThrow('The provider origin changed after this run was created');
  });

  it('keeps member conversation summaries free of instructions and tool policy', () => {
    const summary = service().toConversationSummary(snapshot(), 'available');

    expect(summary).toMatchObject({
      id: 'profile',
      version: 3,
      name: 'Reviewer',
      availability: 'available',
    });
    expect(summary).not.toHaveProperty('instructions');
    expect(summary).not.toHaveProperty('allowedBuiltinCapabilities');
    expect(summary).not.toHaveProperty('toolPolicyFingerprint');
  });

  it('allows editing or clearing a stored override while new overrides are disabled', async () => {
    const profiles = service();
    const existing = {
      row: {
        name: 'Reviewer',
        description: null,
        icon: 'sparkles',
        instructions: 'Review carefully.',
        quickCommands: null,
        chatModelOverride: 'profile-model',
        temperatureOverride: null,
        maxOutputTokensOverride: null,
        allowedBuiltinCapabilities: ['search.query'],
        autoStart: false,
        launchMessage: null,
        enabled: false,
      },
      externalTools: [],
      groupPolicies: [],
    };
    const settings = {
      enabled: true,
      modelOverridesEnabled: false,
      policyVersion: 1,
      updatedAt: null,
    };
    const normalize = (chatModelOverride: string | null) =>
      (profiles as any).normalizeValues(
        { name: 'Renamed', chatModelOverride },
        existing,
        config,
        settings,
        'space',
        'workspace',
        {},
      );

    await expect(normalize('profile-model')).resolves.toMatchObject({
      name: 'Renamed',
      chatModelOverride: 'profile-model',
    });
    await expect(normalize(null)).resolves.toMatchObject({
      chatModelOverride: null,
    });
    await expect(normalize('another-model')).rejects.toThrow(
      'Assistant profile provider overrides are disabled for this workspace',
    );
  });

  it('accepts external MCP expansion but rejects revocation or schema changes', () => {
    const profiles = service();
    const tool = {
      name: 'docs.search',
      remoteName: 'search',
      description: 'Search docs',
      inputSchema: { type: 'object' },
      schemaFingerprint: 'schema-1',
    };
    const connection = {
      serverId: 'server',
      namespace: 'docs',
      configVersion: 2,
      bindingId: 'binding',
      bindingPolicyVersion: 3,
      instructions: null,
      tools: [tool],
    };
    const frozen = {
      schemaVersion: 1,
      profileKey: 'profile',
      workspacePolicyVersion: 4,
      connections: [connection],
    };

    expect(() =>
      (profiles as any).assertFrozenExternalPolicyCurrent(frozen, {
        ...frozen,
        workspacePolicyVersion: 5,
        connections: [
          {
            ...connection,
            bindingPolicyVersion: 4,
            tools: [
              tool,
              {
                ...tool,
                name: 'docs.get',
                remoteName: 'get',
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      (profiles as any).assertFrozenExternalPolicyCurrent(frozen, null),
    ).toThrow('External MCP access or configuration changed during the run');
    expect(() =>
      (profiles as any).assertFrozenExternalPolicyCurrent(frozen, {
        ...frozen,
        connections: [
          {
            ...connection,
            tools: [{ ...tool, schemaFingerprint: 'schema-2' }],
          },
        ],
      }),
    ).toThrow('An external MCP tool was revoked or changed during the run');
  });

  it('maps a deleted profile behind a frozen snapshot to a stable run error', async () => {
    const profiles = service();
    jest
      .spyOn(profiles as any, 'assertProfilesEnabledForRun')
      .mockResolvedValue(undefined);
    const getProfileRow = jest
      .spyOn(profiles as any, 'getProfileRow')
      .mockResolvedValue({
        id: 'profile',
        enabled: false,
        deletedAt: new Date(),
      });

    await expect(
      profiles.assertSnapshotLive(snapshot(), 'user'),
    ).rejects.toMatchObject({
      response: {
        code: 'ai_profile_disabled',
      },
    });
    expect(getProfileRow).toHaveBeenCalledWith(
      'profile',
      undefined,
      undefined,
      expect.anything(),
      true,
    );
  });

  it.each(['constraint', 'constraint_name'])(
    'maps PostgreSQL uniqueness from %s to a conflict',
    (field) => {
      const profiles = service();

      expect(() =>
        (profiles as any).translateUniqueNameError({
          code: '23505',
          [field]: 'ai_assistant_profiles_active_name_unique',
        }),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'ai_profile_name_conflict',
          }),
        }),
      );
    },
  );
});
