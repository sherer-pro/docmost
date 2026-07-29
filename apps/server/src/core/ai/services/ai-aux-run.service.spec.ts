import { AiAuxRunService } from './ai-aux-run.service';

describe('AiAuxRunService queue delivery', () => {
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
});
