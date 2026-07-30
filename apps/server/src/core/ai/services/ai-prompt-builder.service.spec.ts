import { AiPromptBuilderService } from './ai-prompt-builder.service';

describe('AiPromptBuilderService', () => {
  function createService(
    rows: any[] = [],
    options?: { excluded?: string[]; dependencies?: any[] },
  ) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      executeTakeFirst: jest.fn(async () => undefined),
      execute: jest.fn(async () => rows),
    };
    const dependencyQuery: any = {
      select: jest.fn(() => dependencyQuery),
      where: jest.fn(() => dependencyQuery),
      execute: jest.fn(async () => options?.dependencies ?? []),
    };
    return new AiPromptBuilderService(
      {
        selectFrom: jest.fn((table: string) =>
          table === 'aiRunSourceDependencies' ? dependencyQuery : query,
        ),
      } as any,
      options?.excluded
        ? ({
            getExcludedPageIds: jest.fn(async () => new Set(options.excluded)),
          } as any)
        : undefined,
    );
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
    spaceId: 'space',
    workspaceId: 'workspace',
  } as any;

  it('prioritizes a selection over the full document snapshot', async () => {
    const messages = await createService().build({
      run,
      instructions: null,
      currentUserContent: 'current prompt',
      contextSources: [],
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
    const messages = await createService(chronological.slice().reverse()).build(
      {
        run: { ...run, selectionText: null },
        instructions: null,
        currentUserContent: 'current',
        contextSources: [],
        fileText: '',
        fileSources: [],
        images: [],
        retrievalSources: [],
        contextWindow: 32_768,
        maxOutputTokens: 2_048,
      },
    );
    const history = messages.slice(1, -1);

    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', content: 'U2' });
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'A11' });
    expect(history[0].role).toBe('user');
  });

  it('does not add identity instructions by default', async () => {
    const messages = await createService().build({
      run,
      instructions: 'Space instructions',
      currentUserContent: 'current prompt',
      contextSources: [],
      fileText: '',
      fileSources: [],
      images: [],
      retrievalSources: [],
      contextWindow: 32_768,
      maxOutputTokens: 2_048,
    });

    expect(messages[0].content).not.toContain('Assistant identity metadata');
  });

  it('omits history turns derived from a newly excluded page', async () => {
    const rows = [
      {
        id: 'assistant-safe',
        role: 'assistant',
        content: 'safe answer',
        createdAt: new Date('2026-07-29T11:03:00.000Z'),
      },
      {
        id: 'user-safe',
        role: 'user',
        content: 'safe question',
        createdAt: new Date('2026-07-29T11:02:00.000Z'),
      },
      {
        id: 'assistant-blocked',
        role: 'assistant',
        content: 'private answer',
        createdAt: new Date('2026-07-29T11:01:00.000Z'),
      },
      {
        id: 'user-blocked',
        role: 'user',
        content: 'private question',
        createdAt: new Date('2026-07-29T11:00:00.000Z'),
      },
    ];
    const messages = await createService(rows, {
      excluded: ['excluded-page'],
      dependencies: [{ messageId: 'assistant-blocked' }],
    }).build({
      run: { ...run, selectionText: null },
      instructions: null,
      currentUserContent: 'current',
      contextSources: [],
      fileText: '',
      fileSources: [],
      images: [],
      retrievalSources: [],
      contextWindow: 32_768,
      maxOutputTokens: 2_048,
    });

    expect(messages).toContainEqual({
      role: 'assistant',
      content: 'safe answer',
    });
    expect(messages).not.toContainEqual({
      role: 'assistant',
      content: 'private answer',
    });
    expect(messages).not.toContainEqual({
      role: 'user',
      content: 'private question',
    });
  });

  it.each(['masculine', 'feminine'] as const)(
    'adds exact JSON-encoded %s identity after space instructions',
    async (gender) => {
      const name = 'Алиса "A\\B" 🤖';
      const messages = await createService().build({
        run,
        instructions: 'Space instructions',
        assistantIdentity: { name, gender },
        currentUserContent: 'current prompt',
        contextSources: [],
        fileText: '',
        fileSources: [],
        images: [],
        retrievalSources: [],
        contextWindow: 32_768,
        maxOutputTokens: 2_048,
      });
      const system = String(messages[0].content);
      const metadata = JSON.stringify({
        displayName: name,
        grammaticalGender: gender,
      });

      expect(system).toContain(metadata);
      expect(system).toContain(
        'Never translate, transliterate, inflect, or otherwise alter it.',
      );
      expect(system).toContain(`Use ${gender} grammatical agreement`);
      expect(system.indexOf('Space instructions')).toBeLessThan(
        system.indexOf('Assistant identity metadata'),
      );
      expect(system.indexOf('Assistant identity metadata')).toBeLessThan(
        system.indexOf('Cite only server-provided'),
      );
    },
  );
});
