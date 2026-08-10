jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { AiConversationService } from './ai-conversation.service';

describe('AiConversationService message serialization', () => {
  const service = new AiConversationService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const row = {
    id: 'message-id',
    conversationId: 'conversation-id',
    userId: null,
    role: 'assistant',
    content: 'answer',
    reasoning: 'reasoning',
    status: 'completed',
    clientRequestId: null,
    currentRunId: 'run-id',
    inputTokens: 3,
    outputTokens: 5,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-07-29T12:00:00.000Z'),
    updatedAt: new Date('2026-07-29T12:01:00.000Z'),
  };

  it('returns reasoning for an accessible message', () => {
    expect((service as any).toMessage(row, [], false)).toMatchObject({
      content: 'answer',
      reasoning: 'reasoning',
      accessRestricted: false,
    });
  });

  it('hides both answer content and reasoning when access is restricted', () => {
    expect((service as any).toMessage(row, [], true)).toMatchObject({
      content: '',
      reasoning: '',
      accessRestricted: true,
    });
  });

  it('hides derived history when a cited private file is no longer ready', async () => {
    const message = { ...row, currentRunId: 'run-id' };
    const citation = {
      id: 'source-id',
      runId: 'run-id',
      messageId: row.id,
      sourceType: 'chat_file',
      sourceId: 'file-id',
      pageId: null,
      sourceTitle: 'Private file',
      sourceUrl: null,
      excerpt: 'private file canary',
      position: 0,
      displayPosition: 0,
      relevanceScore: null,
      citationKey: 'chat_file:file-id',
      citationState: 'cited',
      sectionId: null,
      sectionTitle: null,
    };
    class Query {
      private filters: Array<[unknown, unknown, unknown]> = [];

      constructor(private readonly table: string) {}

      select() {
        return this;
      }

      selectAll() {
        return this;
      }

      where(column: unknown, operator?: unknown, value?: unknown) {
        this.filters.push([column, operator, value]);
        return this;
      }

      orderBy() {
        return this;
      }

      limit() {
        return this;
      }

      async executeTakeFirst() {
        if (this.table === 'aiConversations') {
          return {
            id: 'conversation-id',
            userId: 'user-id',
            workspaceId: 'workspace-id',
            spaceId: 'space-id',
            pageId: 'page-id',
            agentMode: false,
            deletedAt: null,
          };
        }
        return undefined;
      }

      async execute() {
        if (this.table === 'aiMessages') return [message];
        if (this.table === 'aiMessageSources') return [citation];
        if (this.table === 'aiRuns') {
          return [{ id: 'run-id', assistantMessageId: row.id }];
        }
        if (this.table === 'aiRunSourceDependencies') return [];
        if (this.table === 'aiChatFiles') {
          const readyRequired = this.filters.some(
            ([column, operator, value]) =>
              column === 'status' && operator === '=' && value === 'ready',
          );
          return readyRequired ? [] : [{ id: 'file-id' }];
        }
        return [];
      }
    }
    const history = new AiConversationService(
      { selectFrom: (table: string) => new Query(table) } as any,
      {
        findById: jest.fn(async () => ({
          id: 'page-id',
          workspaceId: 'workspace-id',
          deletedAt: null,
        })),
      } as any,
      { assertCanWritePage: jest.fn(async () => undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { filterAccessible: jest.fn(async (sources) => sources) } as any,
    );

    await expect(
      history.listMessages(
        'conversation-id',
        { limit: 20 } as any,
        { id: 'user-id' } as any,
        { id: 'workspace-id' } as any,
      ),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          content: '',
          reasoning: '',
          accessRestricted: true,
        }),
      ],
    });
  });
});
