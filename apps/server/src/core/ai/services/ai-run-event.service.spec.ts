import { AiRunEventService } from './ai-run-event.service';

describe('AiRunEventService', () => {
  it('emits a backward-compatible reasoning-only delta', () => {
    const emit = jest.fn();
    const service = new AiRunEventService(
      {
        server: {
          to: jest.fn(() => ({ emit })),
        },
      } as any,
      { observeDelta: jest.fn() } as any,
    );

    service.emitDelta(
      {
        id: 'run-id',
        conversationId: 'conversation-id',
        assistantMessageId: 'message-id',
        pageId: 'page-id',
        userId: 'user-id',
      } as any,
      4,
      '',
      'reasoning',
    );

    expect(emit).toHaveBeenCalledWith('ai:run.delta', {
      runId: 'run-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      pageId: 'page-id',
      sequence: 4,
      delta: '',
      reasoningDelta: 'reasoning',
    });
  });
});
