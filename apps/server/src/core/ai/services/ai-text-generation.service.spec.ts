import { encryptProtectedValue } from '../../../common/security/credential-protection.util';
import { AiTextGenerationService } from './ai-text-generation.service';

describe('AiTextGenerationService', () => {
  const appSecret = 'test-app-secret-that-is-at-least-32-characters';
  const executeTakeFirst = jest.fn();
  const query: Record<string, jest.Mock> = {};
  query.selectAll = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.executeTakeFirst = executeTakeFirst;
  const db = {
    selectFrom: jest.fn(() => query),
  };
  const environment = {
    getAppSecret: jest.fn(() => appSecret),
  };
  const provider = {
    complete: jest.fn(),
  };
  const service = new AiTextGenerationService(
    db as any,
    environment as any,
    provider as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no session when generation is disabled', async () => {
    executeTakeFirst.mockResolvedValue({
      enabled: false,
      baseUrl: 'http://provider.test/v1',
      chatModel: 'model-1',
    });

    await expect(
      service.createSession('space-1', 'workspace-1'),
    ).resolves.toBeNull();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('creates a scoped session with decrypted provider configuration', async () => {
    executeTakeFirst.mockResolvedValue({
      enabled: true,
      baseUrl: 'http://provider.test/v1',
      apiKeyEncrypted: encryptProtectedValue('provider-key', appSecret),
      chatModel: 'model-1',
      temperature: 0.2,
      maxOutputTokens: 8192,
      requestTimeoutMs: 300000,
    });
    provider.complete.mockResolvedValue({
      content: 'generated',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const session = await service.createSession('space-1', 'workspace-1');
    await expect(
      session?.complete([{ role: 'user', content: 'term' }], {
        temperature: 0.1,
      }),
    ).resolves.toEqual({
      content: 'generated',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    expect(query.where).toHaveBeenNthCalledWith(1, 'spaceId', '=', 'space-1');
    expect(query.where).toHaveBeenNthCalledWith(
      2,
      'workspaceId',
      '=',
      'workspace-1',
    );
    expect(provider.complete).toHaveBeenCalledWith(
      {
        baseUrl: 'http://provider.test/v1',
        apiKey: 'provider-key',
        chatModel: 'model-1',
        temperature: 0.1,
        maxOutputTokens: 8192,
        requestTimeoutMs: 300000,
      },
      [{ role: 'user', content: 'term' }],
    );
  });
});
