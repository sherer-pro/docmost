import { BadRequestException } from '@nestjs/common';
import { AiProviderUrlPolicyService } from './ai-provider-url-policy.service';
import { AiRetrievalUrlPolicyService } from './ai-retrieval-url-policy.service';
import { AiOutboundUrlPolicyService } from './ai-outbound-url-policy.service';

const lookupMock = jest.fn(async (..._args: unknown[]) => [
  { address: '203.0.113.10', family: 4 },
]);

jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

afterEach(() => {
  lookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
});

describe('AI URL policies', () => {
  it('allows a development loopback provider URL', async () => {
    const environment = {
      isDevelopment: () => true,
      getAiProviderAllowedOrigins: () => '',
    } as any;
    const service = new AiProviderUrlPolicyService(
      environment,
      new AiOutboundUrlPolicyService(environment),
    );
    await expect(
      service.assertAllowed('http://127.0.0.1:56254/v1'),
    ).resolves.toMatchObject({ origin: 'http://127.0.0.1:56254' });
  });

  it('allows an explicitly allowlisted Docker host provider origin', async () => {
    const environment = {
      isDevelopment: () => false,
      getAiProviderAllowedOrigins: () =>
        'http://host.docker.internal:56254',
    } as any;
    const service = new AiProviderUrlPolicyService(
      environment,
      new AiOutboundUrlPolicyService(environment),
    );

    await expect(
      service.assertAllowed('http://host.docker.internal:56254/v1'),
    ).resolves.toMatchObject({
      origin: 'http://host.docker.internal:56254',
      pathname: '/v1',
    });
  });

  it('uses the retrieval allowlist independently', async () => {
    const environment = {
      isDevelopment: () => false,
      getAiRetrievalAllowedOrigins: () => 'https://retrieval.example.test',
    } as any;
    const service = new AiRetrievalUrlPolicyService(
      environment,
      new AiOutboundUrlPolicyService(environment),
    );
    await expect(
      service.assertAllowed('https://retrieval.example.test/query'),
    ).resolves.toMatchObject({
      origin: 'https://retrieval.example.test',
      pathname: '/query',
    });
  });

  it('rejects an origin that is absent from the relevant allowlist', async () => {
    const environment = {
      isDevelopment: () => false,
      getAiRetrievalAllowedOrigins: () => 'https://allowed.example.test',
    } as any;
    const service = new AiRetrievalUrlPolicyService(
      environment,
      new AiOutboundUrlPolicyService(environment),
    );
    await expect(
      service.assertAllowed('http://127.0.0.1:9999/query'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Unspecified and multicast addresses are rejected for every outbound kind,
  // including an origin an administrator explicitly allowlisted.
  it.each([
    ['unspecified IPv4', '0.0.0.0', 4, /unspecified/],
    ['unspecified IPv6', '::', 6, /unspecified/],
    ['multicast IPv4', '224.0.0.1', 4, /multicast/],
    ['multicast IPv6', 'ff02::1', 6, /multicast/],
  ])(
    'rejects an allowlisted provider origin resolving to a %s address',
    async (_label, address, family, expected) => {
      lookupMock.mockResolvedValue([{ address, family }]);
      const environment = {
        isDevelopment: () => false,
        getAiProviderAllowedOrigins: () => 'https://llm.example.test',
      } as any;
      const service = new AiProviderUrlPolicyService(
        environment,
        new AiOutboundUrlPolicyService(environment),
      );

      await expect(
        service.assertAllowed('https://llm.example.test/v1'),
      ).rejects.toThrow(expected);
    },
  );
});
