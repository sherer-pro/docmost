import { EventEmitter } from 'node:events';
import { ApiKeyTrafficGuard } from './api-key-traffic.guard';

describe('ApiKeyTrafficGuard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renews an active lease and stops renewal when the response finishes', async () => {
    jest.useFakeTimers();
    const responseRaw = new EventEmitter() as EventEmitter & {
      statusCode: number;
      getHeader: () => undefined;
    };
    responseRaw.statusCode = 200;
    responseRaw.getHeader = () => undefined;
    const requestRaw = new EventEmitter();
    const traffic = {
      acquire: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
        leaseId: 'lease',
        keys: ['concurrent'],
        renewAfterMs: 100,
      }),
      renew: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
      observeRequest: jest.fn(),
    };
    const guard = new ApiKeyTrafficGuard(
      { getAllAndOverride: () => 'mcp' } as any,
      traffic as any,
      { getMcpTrafficLimits: () => ({}) } as any,
    );
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { apiKey: { id: 'key' } },
          raw: requestRaw,
          url: '/mcp',
        }),
        getResponse: () => ({ raw: responseRaw }),
      }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(traffic.renew).toHaveBeenCalledTimes(1);

    responseRaw.emit('finish');
    await Promise.resolve();
    expect(traffic.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
