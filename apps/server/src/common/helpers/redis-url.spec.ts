import { parseRedisUrl } from './utils';
import { RedisConfigService } from '../../integrations/redis/redis-config.service';

describe('Redis URL configuration', () => {
  it('preserves TLS, ACL identity, escaped credentials, IPv6 and defaults', () => {
    expect(parseRedisUrl('rediss://synthetic:p%40ss@[::1]/2?family=6')).toEqual(
      {
        host: '::1',
        port: 6379,
        username: 'synthetic',
        password: 'p@ss',
        db: 2,
        family: 6,
        tls: {},
      },
    );
    expect(parseRedisUrl('rediss://cache.example.test').tls).toEqual({
      servername: 'cache.example.test',
    });
    expect(parseRedisUrl('redis://127.0.0.1:6381/03?family=4')).toMatchObject({
      host: '127.0.0.1',
      port: 6381,
      db: 3,
      family: 4,
    });
    expect(parseRedisUrl('redis://localhost').tls).toBeUndefined();
    expect(parseRedisUrl('redis://localhost/').db).toBe(0);
  });
  it('passes the complete secure configuration to the main Redis client', () => {
    const config = new RedisConfigService({
      getRedisUrl: () =>
        'rediss://synthetic:p%40ss@cache.example.test/2?family=4',
    } as any).createRedisOptions();
    expect(config.config).toMatchObject({
      host: 'cache.example.test',
      port: 6379,
      username: 'synthetic',
      password: 'p@ss',
      db: 2,
      family: 4,
      tls: { servername: 'cache.example.test' },
      retryStrategy: expect.any(Function),
    });
  });
  it.each([
    'https://synthetic:private-value@host',
    'redis:///2',
    'redis://host:0',
    'redis://host/1junk',
    'redis://host/-1',
    'redis://host/1/2',
    'redis://host/9007199254740992',
    'redis://host?family=7',
    'redis://host?family=6junk',
    'redis://host?family=4&family=6',
    'redis://host?family=',
    'redis://host#fragment',
    'redis://synthetic%ZZ:private-value@host',
  ])(
    'rejects malformed option %# without including credentials in the error',
    (value) => {
      expect(() => parseRedisUrl(value)).toThrow(/^Invalid Redis/);
      try {
        parseRedisUrl(value);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        expect(error.message).not.toContain('private-value');
      }
    },
  );
});
