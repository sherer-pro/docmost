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
    );
    jest.spyOn(service, 'reconcile').mockResolvedValue(undefined);

    service.onModuleInit();
    service.onModuleInit();

    expect(jest.getTimerCount()).toBe(1);
    expect(service.reconcile).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
