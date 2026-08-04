import { PageEmbedGraphLockService } from '../page-embed-graph-lock.service';

describe('PageEmbedGraphLockService', () => {
  it('uses a monotonic process lease only when Redis is explicitly disabled', async () => {
    const redisService = { getOrThrow: jest.fn() };
    const service = new PageEmbedGraphLockService(
      redisService as any,
      {
        isCollabDisableRedis: () => true,
      } as any,
    );

    const first = await service.acquire('workspace-process-lock');
    const firstToken = first.fencingToken;
    await first.release();
    expect(() => first.assertOwned()).toThrow('Page embed graph lock was lost');

    const second = await service.acquire('workspace-process-lock');
    expect(second.fencingToken).toBeGreaterThan(firstToken);
    await second.release();
    expect(redisService.getOrThrow).not.toHaveBeenCalled();
  });

  it('fails closed when Redis no longer contains the owned lease', async () => {
    const redis = {
      incr: jest.fn(async () => 1),
      set: jest.fn(async () => 'OK'),
      get: jest.fn(async () => null),
      eval: jest.fn(async () => 1),
    };
    const service = new PageEmbedGraphLockService(
      { getOrThrow: () => redis } as any,
      { isCollabDisableRedis: () => false } as any,
    );

    const lease = await service.acquire('workspace-redis-lock');
    await expect(lease.assertOwnedAsync()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_graph_lock_lost' }),
    });
    await expect(lease.release()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_graph_lock_lost' }),
    });
  });
});
