import { GatewayTimeoutException } from '@nestjs/common';
import { AiQueryRewriteService } from './ai-query-rewrite.service';

class FakeQuery {
  private role: string | null = null;

  constructor(
    private readonly table: string,
    private readonly data: {
      cutoff?: Date | null;
      userMessages?: any[];
      assistantMessages?: any[];
      sources?: any[];
    },
  ) {}

  select() {
    return this;
  }

  where(columnOrCallback: unknown, _operator?: unknown, value?: unknown) {
    if (typeof columnOrCallback === 'function') {
      const expression: any = () => ({});
      expression.or = () => ({});
      expression.and = () => ({});
      columnOrCallback(expression);
    } else if (columnOrCallback === 'role') {
      this.role = String(value);
    }
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  executeTakeFirst() {
    if (this.table === 'aiConversations') {
      return Promise.resolve({
        promptHistoryCutoffAt: this.data.cutoff ?? null,
      });
    }
    return Promise.resolve(undefined);
  }

  execute() {
    if (this.table === 'aiMessages' && this.role === 'user') {
      return Promise.resolve(this.data.userMessages ?? []);
    }
    if (this.table === 'aiMessages' && this.role === 'assistant') {
      return Promise.resolve(this.data.assistantMessages ?? []);
    }
    if (this.table === 'aiMessageSources') {
      return Promise.resolve(this.data.sources ?? []);
    }
    return Promise.resolve([]);
  }
}

describe('AiQueryRewriteService', () => {
  const run = {
    id: 'run-1',
    conversationId: 'conversation-1',
    userId: 'user-1',
    userMessageId: 'message-current',
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    createdAt: new Date('2026-09-03T10:00:00.000Z'),
  } as any;
  const user = { id: run.userId } as any;
  const providerConfig = {
    baseUrl: 'https://provider.example',
    apiKey: 'secret',
    chatModel: 'model',
    temperature: 0.7,
    maxOutputTokens: 4096,
    requestTimeoutMs: 300_000,
  };

  function setup(data: ConstructorParameters<typeof FakeQuery>[1] = {}) {
    const db = {
      selectFrom: jest.fn((table: string) => new FakeQuery(table, data)),
    };
    const provider = {
      complete: jest.fn().mockResolvedValue({
        content: 'When is Project Atlas launching?',
        usage: { inputTokens: 30, outputTokens: 8 },
      }),
    };
    const sourceAccess = {
      filterAccessible: jest.fn(async (sources) => sources),
    };
    const service = new AiQueryRewriteService(
      db as any,
      provider as any,
      sourceAccess as any,
    );
    return { service, provider, sourceAccess };
  }

  it('rewrites a follow-up from user history and safe citation titles only', async () => {
    const { service, provider, sourceAccess } = setup({
      userMessages: [
        {
          id: 'message-previous',
          content: 'Tell me about Project Atlas',
          createdAt: new Date(),
        },
      ],
      assistantMessages: [{ id: 'assistant-previous' }],
      sources: [
        {
          sourceType: 'page',
          sourceId: 'page-1',
          pageId: 'page-1',
          sourceTitle: 'Atlas launch plan',
        },
      ],
    });

    await expect(
      service.rewrite({
        run,
        user,
        currentQuery: 'When does it launch?',
        requested: true,
        enabled: true,
        providerConfig,
      }),
    ).resolves.toEqual({
      query: 'When is Project Atlas launching?',
      outcome: 'rewritten',
      errorCode: null,
      latencyMs: expect.any(Number),
      usage: { inputTokens: 30, outputTokens: 8 },
    });
    const messages = provider.complete.mock.calls[0][1];
    expect(messages[1].content).toContain('Tell me about Project Atlas');
    expect(messages[1].content).toContain('Atlas launch plan');
    expect(messages[1].content).not.toContain('assistant prose');
    expect(sourceAccess.filterAccessible).toHaveBeenCalled();
    expect(provider.complete.mock.calls[0][0]).toMatchObject({
      temperature: 0,
      maxOutputTokens: 128,
      requestTimeoutMs: 30_000,
    });
  });

  it('skips the provider when there is no prior user message', async () => {
    const { service, provider } = setup();

    await expect(
      service.rewrite({
        run,
        user,
        currentQuery: 'Standalone question',
        requested: true,
        enabled: true,
        providerConfig,
      }),
    ).resolves.toMatchObject({
      query: 'Standalone question',
      outcome: 'unchanged',
    });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('falls back to the original query on invalid or timed-out rewrites', async () => {
    const data = {
      userMessages: [{ id: 'message-previous', content: 'Context' }],
    };
    const invalid = setup(data);
    invalid.provider.complete.mockResolvedValue({
      content: 'First line\nSecond line',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await expect(
      invalid.service.rewrite({
        run,
        user,
        currentQuery: 'Original query',
        requested: true,
        enabled: true,
        providerConfig,
      }),
    ).resolves.toMatchObject({
      query: 'Original query',
      outcome: 'failed',
      errorCode: 'rewrite_invalid_response',
    });

    const timeout = setup(data);
    timeout.provider.complete.mockRejectedValue(new GatewayTimeoutException());
    await expect(
      timeout.service.rewrite({
        run,
        user,
        currentQuery: 'Original query',
        requested: true,
        enabled: true,
        providerConfig,
      }),
    ).resolves.toMatchObject({
      query: 'Original query',
      outcome: 'failed',
      errorCode: 'rewrite_timeout',
    });
  });
});
