import { AiPromptBuilderService } from './ai-prompt-builder.service';

describe('AiPromptBuilderService', () => {
  function createService(rows: any[] = []) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      execute: jest.fn(async () => rows),
    };
    return new AiPromptBuilderService({
      selectFrom: jest.fn(() => query),
    } as any);
  }

  const run = {
    id: 'run',
    conversationId: 'conversation',
    userMessageId: 'current-user',
    assistantMessageId: 'current-assistant',
    selectionText: 'selected content',
    selectionFrom: 3,
    selectionTo: 19,
    documentSnapshot: 'full document must not be included',
    createdAt: new Date('2026-07-29T12:00:00.000Z'),
  } as any;

  it('prioritizes a selection over the full document snapshot', async () => {
    const messages = await createService().build({
      run,
      instructions: null,
      currentUserContent: 'current prompt',
      fileText: 'file context',
      fileSources: [{ sourceTitle: 'File' }],
      images: [],
      retrievalSources: [
        {
          sourceType: 'page',
          sourceId: 'source',
          pageId: 'page',
          sourceTitle: 'Retrieved page',
          sourceUrl: null,
          excerpt: 'retrieved context',
          relevanceScore: 0.9,
        },
      ],
      contextWindow: 32_768,
      maxOutputTokens: 2_048,
    });

    expect(messages[0].content).toContain('selected content');
    expect(messages[0].content).not.toContain(
      'full document must not be included',
    );
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: 'current prompt',
    });
  });

  it('keeps only the latest ten complete user/assistant turns', async () => {
    const chronological = Array.from({ length: 12 }, (_, index) => [
      {
        id: `user-${index}`,
        role: 'user',
        content: `U${index}`,
        createdAt: new Date(2026, 0, 1, 0, index * 2),
      },
      {
        id: `assistant-${index}`,
        role: 'assistant',
        content: `A${index}`,
        createdAt: new Date(2026, 0, 1, 0, index * 2 + 1),
      },
    ]).flat();
    const messages = await createService(
      chronological.slice().reverse(),
    ).build({
      run: { ...run, selectionText: null },
      instructions: null,
      currentUserContent: 'current',
      fileText: '',
      fileSources: [],
      images: [],
      retrievalSources: [],
      contextWindow: 32_768,
      maxOutputTokens: 2_048,
    });
    const history = messages.slice(1, -1);

    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', content: 'U2' });
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'A11' });
    expect(history[0].role).toBe('user');
  });
});
