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
});
