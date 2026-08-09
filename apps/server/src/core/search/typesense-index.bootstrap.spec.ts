import { QueueJob } from '../../integrations/queue/constants';
import { TypesenseIndexService } from './typesense-index.service';

describe('TypesenseIndexService bootstrap reconciliation', () => {
  const createService = () => {
    const environment = {
      getSearchDriver: jest.fn().mockReturnValue('typesense'),
      getTypesenseUrl: jest.fn().mockReturnValue('http://127.0.0.1:18108'),
      getTypesenseApiKey: jest.fn().mockReturnValue('synthetic-key'),
    } as any;
    const queue = { add: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new TypesenseIndexService(environment, {} as any, queue);
    jest
      .spyOn(service as any, 'ensureCollections')
      .mockResolvedValue(undefined);

    return { service, queue };
  };

  it('always registers a deterministic full reconciliation job', async () => {
    const { service, queue } = createService();

    await service.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledWith(
      QueueJob.TYPESENSE_FLUSH,
      {},
      expect.objectContaining({
        jobId: 'typesense-full-reconciliation',
        repeat: { every: 15 * 60_000 },
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 10,
      }),
    );
    await service.onModuleDestroy();
  });

  it('re-registers reconciliation after temporary Redis loss', async () => {
    jest.useFakeTimers();
    try {
      const { service, queue } = createService();
      queue.add
        .mockRejectedValueOnce(new Error('synthetic Redis outage'))
        .mockResolvedValue(undefined);

      await service.onApplicationBootstrap();
      expect(queue.add).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(queue.add).toHaveBeenCalledTimes(2);
      await service.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
