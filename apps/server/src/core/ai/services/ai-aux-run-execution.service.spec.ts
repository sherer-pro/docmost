jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { AiAuxRunExecutionService } from './ai-aux-run-execution.service';

function createService(db: any, overrides: Record<string, any> = {}) {
  return new AiAuxRunExecutionService(
    db,
    overrides.configs ?? ({} as any),
    overrides.conversations ?? ({} as any),
    overrides.provider ?? ({} as any),
    overrides.events ?? ({} as any),
    overrides.runEvents ?? ({} as any),
  );
}

describe('AiAuxRunExecutionService lifecycle', () => {
  it('allows only one worker to claim a queued auxiliary run', async () => {
    let claimed = false;
    const query: any = {};
    query.set = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.returningAll = jest.fn(() => query);
    query.executeTakeFirst = jest.fn(async () => {
      if (claimed) return undefined;
      claimed = true;
      return { id: 'run', status: 'running', sequence: 1 };
    });
    const service = createService({
      updateTable: jest.fn(() => query),
    });

    await expect((service as any).claim('run')).resolves.toMatchObject({
      id: 'run',
      status: 'running',
    });
    await expect((service as any).claim('run')).resolves.toBeUndefined();
  });

  it('does not overwrite a manually renamed conversation', async () => {
    const completed = { id: 'run', conversationId: 'conversation' };
    const updateTable = jest.fn((table: string) => {
      const query: any = {};
      query.set = jest.fn(() => query);
      query.where = jest.fn(() => query);
      query.returningAll = jest.fn(() => query);
      query.executeTakeFirst = jest
        .fn()
        .mockResolvedValue(table === 'aiAuxRuns' ? completed : undefined);
      return query;
    });
    const runEvents = { emitConversationUpdated: jest.fn() };
    const service = createService(
      {
        transaction: () => ({
          execute: (callback: (trx: any) => unknown) =>
            callback({ updateTable }),
        }),
      },
      { runEvents },
    );

    await (service as any).finishTitle(
      {
        id: 'run',
        conversationId: 'conversation',
      },
      'Generated title',
      false,
      { inputTokens: 1, outputTokens: 1 },
    );

    expect(updateTable).toHaveBeenCalledWith('aiConversations');
    expect(runEvents.emitConversationUpdated).not.toHaveBeenCalled();
  });

  it('finishes a title run when its conversation was deleted', async () => {
    const selectQuery: any = {};
    selectQuery.selectAll = jest.fn(() => selectQuery);
    selectQuery.where = jest.fn(() => selectQuery);
    selectQuery.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
    const updateQuery: any = {};
    updateQuery.set = jest.fn(() => updateQuery);
    updateQuery.where = jest.fn(() => updateQuery);
    updateQuery.execute = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      selectFrom: jest.fn(() => selectQuery),
      updateTable: jest.fn(() => updateQuery),
    });

    await (service as any).executeConversationTitle({
      id: 'run',
      conversationId: 'conversation',
    });

    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });
});
