import { AiRunService } from './ai-run.service';

describe('AiRunService queue delivery', () => {
  function createService(queue: any) {
    const query: any = {
      set: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn(async () => undefined),
    };
    return new AiRunService(
      { updateTable: jest.fn(() => query) } as any,
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
});
