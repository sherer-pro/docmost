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
      observeLeaseLoss: jest.fn(),
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

  it('releases a lease acquired after the client disconnects', async () => {
    const responseRaw = new EventEmitter() as EventEmitter & {
      statusCode: number;
      getHeader: () => undefined;
    };
    responseRaw.statusCode = 200;
    responseRaw.getHeader = () => undefined;
    const requestRaw = new EventEmitter();
    let resolveAcquire: (value: any) => void = () => undefined;
    const traffic = {
      acquire: jest.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveAcquire = resolve;
        }),
      ),
      renew: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      observeLeaseLoss: jest.fn(),
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

    const activation = guard.canActivate(context);
    requestRaw.emit('aborted');
    resolveAcquire({
      allowed: true,
      retryAfterMs: 0,
      leaseId: 'late-lease',
      keys: ['concurrent'],
      renewAfterMs: 100,
    });

    await expect(activation).resolves.toBe(false);
    expect(traffic.release).toHaveBeenCalledTimes(1);
    expect(traffic.release).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: 'late-lease' }),
    );
    expect(traffic.observeRequest).toHaveBeenCalledWith(
      'mcp',
      'aborted',
      expect.any(Number),
      0,
    );
  });

  it('fails closed with a stable 503 when lease renewal is lost before headers', async () => {
    jest.useFakeTimers();
    const responseRaw = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headersSent: boolean;
      destroyed: boolean;
      getHeader: () => undefined;
      destroy: jest.Mock;
    };
    responseRaw.statusCode = 200;
    responseRaw.headersSent = false;
    responseRaw.destroyed = false;
    responseRaw.getHeader = () => undefined;
    responseRaw.destroy = jest.fn();
    const requestRaw = new EventEmitter();
    const traffic = {
      acquire: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
        leaseId: 'lease',
        keys: ['concurrent'],
        renewAfterMs: 100,
      }),
      renew: jest.fn().mockResolvedValue(false),
      release: jest.fn().mockResolvedValue(undefined),
      observeLeaseLoss: jest.fn(),
      observeRequest: jest.fn(),
    };
    const response = {
      raw: responseRaw,
      sent: false,
      code: jest.fn().mockReturnThis(),
      send: jest.fn(),
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
        getResponse: () => response,
      }),
    } as any;

    await guard.canActivate(context);
    await jest.advanceTimersByTimeAsync(100);

    expect(response.code).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith({
      statusCode: 503,
      code: 'api_key_limit_lease_lost',
      message: 'API key traffic lease was lost',
    });
    expect(responseRaw.destroy).not.toHaveBeenCalled();
    expect(traffic.observeLeaseLoss).toHaveBeenCalledWith('mcp');
    expect(traffic.observeRequest).toHaveBeenCalledWith(
      'mcp',
      'error',
      expect.any(Number),
      0,
    );
    expect(traffic.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('destroys an active stream when lease renewal is lost after headers', async () => {
    jest.useFakeTimers();
    const responseRaw = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headersSent: boolean;
      destroyed: boolean;
      getHeader: () => undefined;
      destroy: jest.Mock;
    };
    responseRaw.statusCode = 200;
    responseRaw.headersSent = true;
    responseRaw.destroyed = false;
    responseRaw.getHeader = () => undefined;
    responseRaw.destroy = jest.fn(() => responseRaw.emit('close'));
    const requestRaw = new EventEmitter();
    const traffic = {
      acquire: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
        leaseId: 'lease',
        keys: ['concurrent'],
        renewAfterMs: 100,
      }),
      renew: jest.fn().mockResolvedValue(false),
      release: jest.fn().mockResolvedValue(undefined),
      observeLeaseLoss: jest.fn(),
      observeRequest: jest.fn(),
    };
    const response = {
      raw: responseRaw,
      sent: false,
      code: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const guard = new ApiKeyTrafficGuard(
      { getAllAndOverride: () => 'rag' } as any,
      traffic as any,
      { getRagApiTrafficLimits: () => ({}) } as any,
    );
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { apiKey: { id: 'key' } },
          raw: requestRaw,
          url: '/api/rag/pages/page/export',
        }),
        getResponse: () => response,
      }),
    } as any;

    await guard.canActivate(context);
    await jest.advanceTimersByTimeAsync(100);

    expect(response.code).not.toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
    expect(responseRaw.destroy).toHaveBeenCalledTimes(1);
    expect(traffic.observeLeaseLoss).toHaveBeenCalledWith('rag');
    expect(traffic.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not overlap asynchronous lease renewals', async () => {
    jest.useFakeTimers();
    const responseRaw = new EventEmitter() as EventEmitter & {
      statusCode: number;
      getHeader: () => undefined;
    };
    responseRaw.statusCode = 200;
    responseRaw.getHeader = () => undefined;
    const requestRaw = new EventEmitter();
    let resolveRenew: (value: boolean) => void = () => undefined;
    const pendingRenewal = new Promise<boolean>((resolve) => {
      resolveRenew = resolve;
    });
    const traffic = {
      acquire: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
        leaseId: 'lease',
        keys: ['concurrent'],
        renewAfterMs: 100,
      }),
      renew: jest.fn().mockReturnValue(pendingRenewal),
      release: jest.fn().mockResolvedValue(undefined),
      observeLeaseLoss: jest.fn(),
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

    await guard.canActivate(context);
    await jest.advanceTimersByTimeAsync(200);
    expect(traffic.renew).toHaveBeenCalledTimes(1);

    resolveRenew(true);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(100);
    expect(traffic.renew).toHaveBeenCalledTimes(2);

    responseRaw.emit('finish');
    expect(jest.getTimerCount()).toBe(0);
  });
});
