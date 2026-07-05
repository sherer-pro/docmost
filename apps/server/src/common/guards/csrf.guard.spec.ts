import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { CsrfService } from '../security/csrf.service';

describe('CsrfGuard', () => {
  const createContext = (request: Record<string, any>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext;

  const createGuard = () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const environmentService = {
      getAppUrl: () => 'https://app.docmost.test',
      isHttps: () => true,
    };

    return new CsrfGuard(reflector, environmentService as any);
  };

  it('allows same-origin mutating requests with a matching CSRF token', () => {
    const guard = createGuard();
    const request = {
      method: 'POST',
      headers: {
        host: 'team.docmost.test',
        origin: 'https://team.docmost.test',
        [CsrfService.HEADER_NAME]: 'csrf-token',
      },
      cookies: {
        [CsrfService.COOKIE_NAME]: 'csrf-token',
      },
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it('rejects mutating requests with a foreign origin before token comparison', () => {
    const guard = createGuard();
    const request = {
      method: 'POST',
      headers: {
        host: 'team.docmost.test',
        origin: 'https://attacker.test',
        [CsrfService.HEADER_NAME]: 'csrf-token',
      },
      cookies: {
        [CsrfService.COOKIE_NAME]: 'csrf-token',
      },
    };

    expect(() => guard.canActivate(createContext(request))).toThrow(
      'CSRF origin validation failed',
    );
  });
});
