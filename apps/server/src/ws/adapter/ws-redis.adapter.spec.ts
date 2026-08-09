import { WsRedisIoAdapter } from './ws-redis.adapter';

describe('WsRedisIoAdapter', () => {
  it('disconnects its Redis clients when Nest disposes the adapter', async () => {
    const adapter = new WsRedisIoAdapter({} as any);
    const pubClient = { disconnect: jest.fn() };
    const subClient = { disconnect: jest.fn() };
    (adapter as any).pubClient = pubClient;
    (adapter as any).subClient = subClient;

    await adapter.dispose();
    await adapter.dispose();

    expect(pubClient.disconnect).toHaveBeenCalledTimes(1);
    expect(pubClient.disconnect).toHaveBeenCalledWith(false);
    expect(subClient.disconnect).toHaveBeenCalledTimes(1);
    expect(subClient.disconnect).toHaveBeenCalledWith(false);
  });
});
