import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthRateLimitService } from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  let service: AuthRateLimitService;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    eventEmitter = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    service = new AuthRateLimitService(eventEmitter);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('блокирует запросы после превышения лимита и публикует telemetry событие', () => {
    const first = service.consume({
      endpoint: 'login',
      scope: 'ip',
      key: '127.0.0.1',
      limit: 1,
      windowMs: 1_000,
      now: 10,
    });

    const second = service.consume({
      endpoint: 'login',
      scope: 'ip',
      key: '127.0.0.1',
      limit: 1,
      windowMs: 1_000,
      now: 11,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'auth.rate_limit.exceeded',
      expect.objectContaining({ endpoint: 'login', scope: 'ip', limit: 1 }),
    );

    expect(service.getTelemetryCounters().get('login')).toEqual({
      ip: 1,
      account: 0,
    });
  });

  it('сбрасывает окно после истечения windowMs и снова разрешает попытки', () => {
    const blocked = service.consume({
      endpoint: 'forgotPassword',
      scope: 'account',
      key: 'user@example.com',
      limit: 1,
      windowMs: 1_000,
      now: 100,
    });

    const exceeded = service.consume({
      endpoint: 'forgotPassword',
      scope: 'account',
      key: 'user@example.com',
      limit: 1,
      windowMs: 1_000,
      now: 101,
    });

    const afterWindow = service.consume({
      endpoint: 'forgotPassword',
      scope: 'account',
      key: 'user@example.com',
      limit: 1,
      windowMs: 1_000,
      now: 1_101,
    });

    expect(blocked.allowed).toBe(true);
    expect(exceeded.allowed).toBe(false);
    expect(afterWindow.allowed).toBe(true);
  });
});
