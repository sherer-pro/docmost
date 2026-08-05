jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

jest.mock('./ai-run-step.service', () => ({
  AiRunStepService: class AiRunStepService {},
}));
jest.mock('./ai-run.service', () => ({
  AiRunService: class AiRunService {},
}));

import { AiQueueReconcilerService } from './ai-queue-reconciler.service';

describe('AiQueueReconcilerService lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates one timer and removes it during shutdown', async () => {
    jest.useFakeTimers();
    const service = new AiQueueReconcilerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { waitUntilReady: jest.fn().mockResolvedValue(undefined) } as any,
      { observeReconciledJob: jest.fn() } as any,
      {} as any,
      {} as any,
      {
        expirePending: jest.fn().mockResolvedValue(0),
        recoverApproved: jest.fn().mockResolvedValue(0),
      } as any,
    );
    jest.spyOn(service, 'reconcile').mockResolvedValue(undefined);

    service.onModuleInit();
    service.onModuleInit();

    expect(jest.getTimerCount()).toBe(1);
    expect(service.reconcile).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for in-flight reconciliation before shutdown completes', async () => {
    let finishStep!: () => void;
    const pendingStep = new Promise<void>((resolve) => {
      finishStep = resolve;
    });
    const steps = {
      expirePending: jest.fn(() => pendingStep),
      recoverApproved: jest.fn().mockResolvedValue(0),
    };
    const files = {
      recoverStaleExtractions: jest.fn().mockResolvedValue([]),
      pendingExtractionIds: jest.fn().mockResolvedValue([]),
      enqueueExtraction: jest.fn(),
      cleanupDeletedFiles: jest.fn().mockResolvedValue(0),
    };
    const service = new AiQueueReconcilerService(
      {} as any,
      {} as any,
      files as any,
      {} as any,
      { waitUntilReady: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      { cleanupExpired: jest.fn().mockResolvedValue(0) } as any,
      {} as any,
      steps as any,
    );
    jest.spyOn(service as any, 'reconcileRuns').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'reconcileAuxRuns').mockResolvedValue(undefined);

    const reconciliation = service.reconcile();
    await Promise.resolve();
    let shutdownCompleted = false;
    const shutdown = service.onModuleDestroy().then(() => {
      shutdownCompleted = true;
    });

    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    finishStep();
    await reconciliation;
    await shutdown;
    expect(shutdownCompleted).toBe(true);
  });

  it('recovers decided approvals before reconciling queued work', async () => {
    const steps = {
      expirePending: jest.fn().mockResolvedValue(0),
      recoverApproved: jest.fn().mockResolvedValue(1),
    };
    const files = {
      recoverStaleExtractions: jest.fn().mockResolvedValue([]),
      pendingExtractionIds: jest.fn().mockResolvedValue([]),
      enqueueExtraction: jest.fn(),
      cleanupDeletedFiles: jest.fn().mockResolvedValue(0),
    };
    const service = new AiQueueReconcilerService(
      {} as any,
      {} as any,
      files as any,
      {} as any,
      { waitUntilReady: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      { cleanupExpired: jest.fn().mockResolvedValue(0) } as any,
      {} as any,
      steps as any,
    );
    const reconcileRuns = jest
      .spyOn(service as any, 'reconcileRuns')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'reconcileAuxRuns').mockResolvedValue(undefined);

    await service.reconcile();

    expect(steps.expirePending).toHaveBeenCalledWith(100);
    expect(steps.recoverApproved).toHaveBeenCalledWith(100);
    expect(steps.recoverApproved.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileRuns.mock.invocationCallOrder[0],
    );
  });

  it('terminally cancels stale running work when cancellation was requested', async () => {
    const db = createRunReconcileDb([
      {
        id: 'cancelled-run',
        cancelRequestedAt: new Date('2026-08-01T12:00:00.000Z'),
      },
    ]);
    const service = createService(db);
    const cancelRun = jest
      .spyOn(service as any, 'cancelRun')
      .mockResolvedValue(undefined);
    const failRun = jest
      .spyOn(service as any, 'failRun')
      .mockResolvedValue(undefined);

    await (service as any).reconcileRuns();

    expect(cancelRun).toHaveBeenCalledWith('cancelled-run');
    expect(failRun).not.toHaveBeenCalled();
  });

  it('fails stale running work when cancellation was not requested', async () => {
    const db = createRunReconcileDb([
      { id: 'lost-run', cancelRequestedAt: null },
    ]);
    const service = createService(db);
    const cancelRun = jest
      .spyOn(service as any, 'cancelRun')
      .mockResolvedValue(undefined);
    const failRun = jest
      .spyOn(service as any, 'failRun')
      .mockResolvedValue(undefined);

    await (service as any).reconcileRuns();

    expect(cancelRun).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledWith(
      'lost-run',
      'worker_lost',
      'AI generation worker stopped responding',
    );
  });

  it('persists a stale cancellation once and preserves partial output', async () => {
    const run = {
      id: 'run-id',
      assistantMessageId: 'assistant-message-id',
      status: 'cancelled',
      sequence: 2,
    };
    const runResults = [run, undefined];
    let runPatch: Record<string, unknown> = {};
    let messagePatch: Record<string, unknown> = {};
    const messageUpdateExecute = jest.fn(async () => undefined);
    const trx = {
      selectFrom: jest.fn(() => createMessageSelect()),
      updateTable: jest.fn((table: string) => {
        const query: any = {
          set: jest.fn((patch) => {
            if (table === 'aiRuns') runPatch = patch;
            if (table === 'aiMessages') messagePatch = patch;
            return query;
          }),
          where: jest.fn(() => query),
          returningAll: jest.fn(() => query),
          executeTakeFirst: jest.fn(async () => runResults.shift()),
          execute: messageUpdateExecute,
        };
        return query;
      }),
    };
    const db = {
      transaction: () => ({
        execute: (callback: (value: typeof trx) => unknown) => callback(trx),
      }),
    };
    const events = { emitStatus: jest.fn() };
    const service = createService(db, events);

    await (service as any).cancelRun('run-id');
    await (service as any).cancelRun('run-id');

    expect(runPatch).toMatchObject({
      status: 'cancelled',
      finishReason: 'cancelled',
      responseSnapshot: 'partial answer',
      reasoningSnapshot: 'partial reasoning',
    });
    expect(messagePatch).toMatchObject({
      content: 'partial answer',
      reasoning: 'partial reasoning',
      status: 'cancelled',
    });
    expect(messageUpdateExecute).toHaveBeenCalledTimes(1);
    expect(events.emitStatus).toHaveBeenCalledTimes(1);
    expect(events.emitStatus).toHaveBeenCalledWith(run, 2, 'cancelled', {
      finishReason: 'cancelled',
    });
  });

  it('keeps worker-loss recovery idempotent when a worker wins the race', async () => {
    const runUpdateExecute = jest.fn().mockResolvedValue(undefined);
    const messageUpdateExecute = jest.fn(async () => undefined);
    const trx = {
      selectFrom: jest.fn(() => createMessageSelect()),
      updateTable: jest.fn((table: string) => {
        const query: any = {
          set: jest.fn(() => query),
          where: jest.fn(() => query),
          returningAll: jest.fn(() => query),
          executeTakeFirst:
            table === 'aiRuns'
              ? runUpdateExecute
              : jest.fn().mockResolvedValue(undefined),
          execute: messageUpdateExecute,
        };
        return query;
      }),
    };
    const db = {
      transaction: () => ({
        execute: (callback: (value: typeof trx) => unknown) => callback(trx),
      }),
    };
    const events = { emitStatus: jest.fn() };
    const service = createService(db, events);

    await (service as any).failRun(
      'run-id',
      'worker_lost',
      'AI generation worker stopped responding',
    );

    expect(runUpdateExecute).toHaveBeenCalledTimes(1);
    expect(messageUpdateExecute).not.toHaveBeenCalled();
    expect(events.emitStatus).not.toHaveBeenCalled();
  });
});

function createService(db: any, events = { emitStatus: jest.fn() }) {
  return new AiQueueReconcilerService(
    db,
    { enqueue: jest.fn().mockResolvedValue(true) } as any,
    {} as any,
    events as any,
    { waitUntilReady: jest.fn().mockResolvedValue(undefined) } as any,
    { observeReconciledJob: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function createRunReconcileDb(staleRuns: any[]) {
  const query = (result: any[]) => {
    const value: any = {
      selectAll: jest.fn(() => value),
      select: jest.fn(() => value),
      where: jest.fn(() => value),
      orderBy: jest.fn(() => value),
      limit: jest.fn(() => value),
      execute: jest.fn().mockResolvedValue(result),
    };
    return value;
  };
  return {
    selectFrom: jest
      .fn()
      .mockImplementationOnce(() => query([]))
      .mockImplementationOnce(() => query(staleRuns)),
  };
}

function createMessageSelect() {
  const query: any = {
    innerJoin: jest.fn(() => query),
    select: jest.fn(() => query),
    where: jest.fn(() => query),
    executeTakeFirst: jest.fn(async () => ({
      content: 'partial answer',
      reasoning: 'partial reasoning',
    })),
  };
  return query;
}
