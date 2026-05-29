import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getClientIpFromFastifyRequest,
  getClientIpFromRawRequest,
  getTrustedProxiesFromEnv,
  parseTrustedProxies,
} from './trusted-proxy.util';

function createRawRequest(remoteAddress: string, forwardedFor?: string) {
  const request = new Readable({ read() {} }) as any;
  request.headers = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};
  request.socket = { remoteAddress };
  request.remoteAddress = remoteAddress;

  return request;
}

describe('trusted proxy utilities', () => {
  const originalTrustedProxies = process.env.TRUSTED_PROXIES;

  afterEach(() => {
    if (typeof originalTrustedProxies === 'undefined') {
      delete process.env.TRUSTED_PROXIES;
    } else {
      process.env.TRUSTED_PROXIES = originalTrustedProxies;
    }
  });

  it('does not trust forwarded headers by default', () => {
    const request = createRawRequest(
      '10.0.0.10',
      '203.0.113.10, 10.0.0.10',
    );

    expect(getClientIpFromRawRequest(request, false)).toBe('10.0.0.10');
  });

  it('resolves the client IP through explicitly trusted proxies', () => {
    const request = createRawRequest(
      '10.0.0.10',
      '203.0.113.10, 10.0.0.10',
    );

    expect(getClientIpFromRawRequest(request, ['10.0.0.10'])).toBe(
      '203.0.113.10',
    );
  });

  it('supports explicit trust-all compatibility mode', () => {
    const request = createRawRequest(
      '10.0.0.10',
      '203.0.113.10, 198.51.100.5',
    );

    expect(getClientIpFromRawRequest(request, true)).toBe('203.0.113.10');
  });

  it('prefers the Fastify-resolved request IP', () => {
    expect(
      getClientIpFromFastifyRequest({
        ip: '203.0.113.10',
        ips: ['198.51.100.5'],
      } as any),
    ).toBe('203.0.113.10');
  });

  it('parses disabled, trust-all, and explicit proxy values', () => {
    expect(parseTrustedProxies(undefined)).toBe(false);
    expect(parseTrustedProxies('false')).toBe(false);
    expect(parseTrustedProxies('true')).toBe(true);
    expect(parseTrustedProxies('*')).toBe(true);
    expect(parseTrustedProxies('loopback, 10.0.0.0/8')).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);
  });

  it('loads TRUSTED_PROXIES from an env file before ConfigModule starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docmost-proxy-env-'));
    const envFile = join(dir, '.env');

    delete process.env.TRUSTED_PROXIES;
    writeFileSync(envFile, 'TRUSTED_PROXIES="loopback,10.0.0.0/8"\n');

    expect(getTrustedProxiesFromEnv(envFile)).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers process env over the env file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docmost-proxy-env-'));
    const envFile = join(dir, '.env');

    process.env.TRUSTED_PROXIES = 'true';
    writeFileSync(envFile, 'TRUSTED_PROXIES=10.0.0.0/8\n');

    expect(getTrustedProxiesFromEnv(envFile)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
