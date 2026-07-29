import { AiAuxRunService } from './ai-aux-run.service';

describe('AiAuxRunService', () => {
  function createAdmissionService(results: Array<Record<string, number>>) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirstOrThrow: jest.fn(async () => results.shift()),
    };
    const db = { selectFrom: jest.fn(() => query) };
    return {
      db,
      service: new AiAuxRunService(
        db as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      ),
    };
  }

  it('uses a BullMQ-safe deterministic job id and a runId-only payload', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const updateQuery: any = {};
    updateQuery.set = jest.fn(() => updateQuery);
    updateQuery.where = jest.fn(() => updateQuery);
    updateQuery.execute = jest.fn().mockResolvedValue(undefined);
    const service = new AiAuxRunService(
      { updateTable: jest.fn(() => updateQuery) } as any,
      {
        getJob: jest.fn().mockResolvedValue(undefined),
        add,
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.enqueue({ id: 'run-id', status: 'queued' } as any),
    ).resolves.toBe(true);

    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      { runId: 'run-id' },
      expect.objectContaining({
        jobId: 'ai-aux-run-id',
        attempts: 1,
      }),
    );
    expect(add.mock.calls[0][1]).toEqual({ runId: 'run-id' });
  });

  it('does not add a duplicate while the deterministic job is active', async () => {
    const add = jest.fn();
    const service = new AiAuxRunService(
      {} as any,
      {
        getJob: jest.fn().mockResolvedValue({
          getState: jest.fn().mockResolvedValue('waiting'),
        }),
        add,
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.enqueue({ id: 'run-id', status: 'queued' } as any),
    ).resolves.toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  it('admits a fifth active AI run for an editor action', async () => {
    const { db, service } = createAdmissionService([
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: 4 },
      { count: 0 },
      { count: 4 },
      { count: 0 },
    ]);

    await expect(
      (service as any).assertAdmission(
        db,
        'user-id',
        'workspace-id',
        'space-id',
        100,
        10000,
        100,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a sixth active AI run for an editor action', async () => {
    const { db, service } = createAdmissionService([
      { count: 0 },
      { count: 0 },
      { tokens: 0 },
      { tokens: 0 },
      { count: 5 },
      { count: 0 },
      { count: 5 },
      { count: 0 },
    ]);

    await expect(
      (service as any).assertAdmission(
        db,
        'user-id',
        'workspace-id',
        'space-id',
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
