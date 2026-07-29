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

  it('admits a fifth active AI run for the user', async () => {
    const results = [
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: 0 },
      { count: 4 },
      { count: 0 },
      { count: 4 },
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

  it('rejects a sixth active AI run for the user', async () => {
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
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'ai_conversation_busy',
      },
    });
  });
});
