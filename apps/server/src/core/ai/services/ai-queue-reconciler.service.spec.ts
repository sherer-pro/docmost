jest.mock('./ai-run-step.service', () => ({
  AiRunStepService: class AiRunStepService {},
}));

import { AiQueueReconcilerService } from './ai-queue-reconciler.service';

describe('AiQueueReconcilerService lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates one timer and removes it during shutdown', () => {
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

    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
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
    jest
      .spyOn(service as any, 'reconcileAuxRuns')
      .mockResolvedValue(undefined);

    await service.reconcile();

    expect(steps.expirePending).toHaveBeenCalledWith(100);
    expect(steps.recoverApproved).toHaveBeenCalledWith(100);
    expect(steps.recoverApproved.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileRuns.mock.invocationCallOrder[0],
    );
  });
});
