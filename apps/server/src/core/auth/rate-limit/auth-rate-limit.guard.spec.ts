import type { ExecutionContext } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

describe('AuthRateLimitGuard', () => {
  it('uses the authenticated session id as the account key', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({
        endpoint: 'mfaVerify',
        accountField: 'sessionId',
      }),
    };
    const authRateLimitService = {
      consume: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
        storageAvailable: true,
      }),
    };
    const request = {
      ip: '127.0.0.1',
      raw: { sessionId: 'session-1' },
      body: {},
      query: {},
      params: {},
      cookies: {},
      headers: {},
    };
    const context = {
      getHandler: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new AuthRateLimitGuard(
      reflector as any,
      authRateLimitService as any,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authRateLimitService.consume).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ scope: 'account', key: 'session-1' }),
    );
  });

  it('reports Redis storage outages as service unavailable, not throttling', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({
        endpoint: 'login',
        accountField: 'email',
      }),
    };
    const authRateLimitService = {
      consume: jest.fn().mockResolvedValue({
        allowed: false,
        retryAfterMs: 600_000,
        storageAvailable: false,
      }),
    };
    const request = {
      ip: '127.0.0.1',
      raw: {},
      body: { email: 'user@example.test' },
      query: {},
      params: {},
      cookies: {},
      headers: {},
    };
    const context = {
      getHandler: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new AuthRateLimitGuard(
      reflector as any,
      authRateLimitService as any,
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        message: 'Authentication rate limiter temporarily unavailable',
      }),
    });
  });
});
