import { lookup } from 'node:dns/promises';
import {
  isPublicPushAddress,
  PushEndpointPolicyService,
} from './push-endpoint-policy.service';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

describe('Push endpoint policy', () => {
  const policy = (origins = 'https://push.example.test') =>
    new PushEndpointPolicyService({
      getWebPushAllowedOrigins: () => origins,
    } as any);
  beforeEach(() => jest.resetAllMocks());

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '192.0.2.1',
    '198.18.0.1',
    '224.1.1.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    '2002:a00:1::',
    '2001:db8::1',
    '3fff::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicPushAddress(address)).toBe(false);
  });
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])('accepts public address %s', (address) => {
    expect(isPublicPushAddress(address)).toBe(true);
  });
  it.each([
    'http://push.example.test/a',
    'https://other.example.test/a',
    'https://user:pass@push.example.test/a',
    'https://push.example.test/a#fragment',
  ])('rejects an unapproved URL before DNS: %s', async (url) => {
    await expect(policy().assertAllowed(url)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
  it('fails closed without a valid exact origin', async () => {
    for (const origins of [
      '',
      '*',
      'https://push.example.test/path',
      'http://push.example.test',
    ]) {
      expect(policy(origins).isConfigured()).toBe(false);
      await expect(
        policy(origins).assertAllowed('https://push.example.test/a'),
      ).rejects.toThrow();
    }
    expect(lookup).not.toHaveBeenCalled();
  });
  it('rejects a mixed DNS answer and a changed answer on a later delivery', async () => {
    jest
      .mocked(lookup)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any)
      .mockResolvedValueOnce([
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ] as any);
    await expect(
      policy().assertAllowed('https://push.example.test/a'),
    ).resolves.toMatchObject({ address: '8.8.8.8', family: 4 });
    await expect(
      policy().assertAllowed('https://push.example.test/a'),
    ).rejects.toThrow();
  });
  it('rejects an explicitly allowlisted private literal in every environment', async () => {
    await expect(
      policy('https://127.0.0.1').assertAllowed('https://127.0.0.1/a'),
    ).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
  it('retains retry semantics for temporary DNS failures without exposing the endpoint', async () => {
    jest
      .mocked(lookup)
      .mockRejectedValue(
        Object.assign(new Error('private-endpoint-canary'), {
          code: 'EAI_AGAIN',
        }),
      );
    await expect(
      policy().assertAllowed('https://push.example.test/a'),
    ).rejects.toMatchObject({ code: 'EAI_AGAIN', status: 503 });
    await expect(
      policy().assertAllowed('https://push.example.test/a'),
    ).rejects.not.toThrow('private-endpoint-canary');
  });
});
