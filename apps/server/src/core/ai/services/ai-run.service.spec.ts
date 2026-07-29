import { AiRunService } from './ai-run.service';

describe('AiRunService', () => {
  function createService(queue: any, db?: any) {
    const query: any = {
      set: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn(async () => undefined),
    };
    return new AiRunService(
      db ?? ({ updateTable: jest.fn(() => query) } as any),
      queue,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('uses a deterministic Bull job id and a runId-only payload', async () => {
    const queue = {
      getJob: jest.fn(async () => undefined),
      add: jest.fn(async () => undefined),
    };
    const service = createService(queue);

    await expect(
      service.enqueue({ id: 'run-id', status: 'queued' } as any),
    ).resolves.toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      expect.any(String),
      { runId: 'run-id' },
      expect.objectContaining({ jobId: 'ai-run-run-id', attempts: 1 }),
    );
  });

  it('keeps a queued run durable when Bull is unavailable', async () => {
    const service = createService({
      getJob: jest.fn(async () => undefined),
      add: jest.fn(async () => {
        throw new Error('Redis unavailable');
      }),
    });

    await expect(
      service.enqueue({ id: 'run-id', status: 'queued' } as any),
    ).resolves.toBe(false);
  });

  it('admits a sixth active AI run for the user', async () => {
    const results = [
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: 0 },
      { count: 5 },
      { count: 0 },
      { count: 5 },
      { count: 0 },
    ];
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirstOrThrow: jest.fn(async () => results.shift()),
    };
    const db = { selectFrom: jest.fn(() => query) };
    const service = createService({} as any, db);

    await expect(
      (service as any).assertQuotaAndConcurrency(
        db,
        'user-id',
        'workspace-id',
        'space-id',
        'conversation-id',
        100,
        10000,
        100,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a seventh active AI run for the user', async () => {
    const results = [
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: 0 },
      { count: 6 },
      { count: 0 },
      { count: 6 },
      { count: 0 },
    ];
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirstOrThrow: jest.fn(async () => results.shift()),
    };
    const db = { selectFrom: jest.fn(() => query) };
    const service = createService({} as any, db);

    await expect(
      (service as any).assertQuotaAndConcurrency(
        db,
        'user-id',
        'workspace-id',
        'space-id',
        'conversation-id',
        100,
        10000,
        100,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'ai_conversation_busy',
      },
    });
  });

  it('cancels a queued run terminally and removes its Bull job', async () => {
    const run = createRun('queued');
    let runPatch: Record<string, unknown> = {};
    const runSelect: any = {
      selectAll: jest.fn(() => runSelect),
      where: jest.fn(() => runSelect),
      forUpdate: jest.fn(() => runSelect),
      executeTakeFirstOrThrow: jest.fn(async () => run),
    };
    const messageSelect: any = {
      select: jest.fn(() => messageSelect),
      where: jest.fn(() => messageSelect),
      executeTakeFirst: jest.fn(async () => ({ content: 'partial' })),
    };
    const runUpdate: any = {
      set: jest.fn((patch) => {
        runPatch = patch;
        return runUpdate;
      }),
      where: jest.fn(() => runUpdate),
      returningAll: jest.fn(() => runUpdate),
      executeTakeFirst: jest.fn(async () => ({ ...run, ...runPatch })),
    };
    const messageUpdate: any = {
      set: jest.fn(() => messageUpdate),
      where: jest.fn(() => messageUpdate),
      execute: jest.fn(async () => undefined),
    };
    const trx = {
      selectFrom: jest.fn((table) =>
        table === 'aiRuns' ? runSelect : messageSelect,
      ),
      updateTable: jest.fn((table) =>
        table === 'aiRuns' ? runUpdate : messageUpdate,
      ),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (transaction: any) => unknown) => callback(trx),
      })),
    };
    const remove = jest.fn(async () => undefined);
    const queue = {
      getJob: jest.fn(async () => ({ remove })),
    };
    const events = { emitStatus: jest.fn() };
    const service = new AiRunService(
      db as any,
      queue as any,
      {} as any,
      {} as any,
      {} as any,
      events as any,
      {} as any,
    );
    jest.spyOn(service as any, 'getOwnedRun').mockResolvedValue(run);

    await expect(
      service.cancel('run-id', {} as any, {} as any),
    ).resolves.toMatchObject({
      status: 'cancelled',
      sequence: 2,
      cancelRequestedAt: expect.any(String),
      finishReason: 'cancelled',
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(events.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      2,
      'cancelled',
      { finishReason: 'cancelled' },
    );
  });

  it('marks a running run with cancelRequestedAt without terminating it', async () => {
    const run = createRun('running');
    let runPatch: Record<string, unknown> = {};
    const runSelect: any = {
      selectAll: jest.fn(() => runSelect),
      where: jest.fn(() => runSelect),
      forUpdate: jest.fn(() => runSelect),
      executeTakeFirstOrThrow: jest.fn(async () => run),
    };
    const runUpdate: any = {
      set: jest.fn((patch) => {
        runPatch = patch;
        return runUpdate;
      }),
      where: jest.fn(() => runUpdate),
      returningAll: jest.fn(() => runUpdate),
      executeTakeFirstOrThrow: jest.fn(async () => ({
        ...run,
        ...runPatch,
      })),
    };
    const trx = {
      selectFrom: jest.fn(() => runSelect),
      updateTable: jest.fn(() => runUpdate),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (transaction: any) => unknown) => callback(trx),
      })),
    };
    const service = new AiRunService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'getOwnedRun').mockResolvedValue(run);

    await expect(
      service.cancel('run-id', {} as any, {} as any),
    ).resolves.toMatchObject({
      status: 'running',
      cancelRequestedAt: expect.any(String),
      completedAt: null,
    });
  });
});

function createRun(status: 'queued' | 'running') {
  const createdAt = new Date('2026-07-29T12:00:00.000Z');
  return {
    id: 'run-id',
    conversationId: 'conversation-id',
    userId: 'user-id',
    workspaceId: 'workspace-id',
    spaceId: 'space-id',
    pageId: 'page-id',
    userMessageId: 'user-message-id',
    assistantMessageId: 'assistant-message-id',
    rootRunId: 'run-id',
    previousRunId: null,
    attemptNo: 1,
    trigger: 'send',
    status,
    clientRequestId: 'request-id',
    contextRevision: 1,
    useSpaceSearch: false,
    chatFileIds: [],
    attachmentIds: [],
    snapshotHash: null,
    selectionText: null,
    selectionFrom: null,
    selectionTo: null,
    sequence: 1,
    reservedTokens: 0,
    enqueuedAt: createdAt,
    startedAt: status === 'running' ? createdAt : null,
    completedAt: null,
    cancelRequestedAt: null,
    errorCode: null,
    errorMessage: null,
    finishReason: null,
    retrievalOutcome: 'not_requested',
    retrievalErrorCode: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt,
    updatedAt: createdAt,
  } as any;
}
