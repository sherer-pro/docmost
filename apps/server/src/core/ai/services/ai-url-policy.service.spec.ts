import { BadRequestException } from '@nestjs/common';
import { AiProviderUrlPolicyService } from './ai-provider-url-policy.service';
import { AiRetrievalUrlPolicyService } from './ai-retrieval-url-policy.service';
import { AiOutboundUrlPolicyService } from './ai-outbound-url-policy.service';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '203.0.113.10', family: 4 }]),
}));

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
});
