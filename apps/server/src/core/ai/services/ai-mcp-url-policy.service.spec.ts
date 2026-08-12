import { BadRequestException } from '@nestjs/common';
import { AiMcpUrlPolicyService } from './ai-mcp-url-policy.service';
import { AiOutboundUrlPolicyService } from './ai-outbound-url-policy.service';

const lookupMock = jest.fn();

jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const DEPLOYMENT_ORIGINS = 'https://mcp.example.test';
const WORKSPACE_ORIGINS = 'https://mcp.example.test';

function buildService(options?: {
  development?: boolean;
  deploymentOrigins?: string;
}): AiMcpUrlPolicyService {
  const environment = {
    isDevelopment: () => options?.development ?? false,
    getAiMcpAllowedOrigins: () =>
      options?.deploymentOrigins ?? DEPLOYMENT_ORIGINS,
  } as any;
  return new AiMcpUrlPolicyService(
    environment,
    new AiOutboundUrlPolicyService(environment),
  );
}

function resolvesTo(...addresses: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValue(addresses);
}

beforeEach(() => {
  lookupMock.mockReset();
  resolvesTo({ address: '203.0.113.10', family: 4 });
});

describe('AiMcpUrlPolicyService dual allowlist', () => {
  it('allows an origin present in both the deployment and workspace allowlists', async () => {
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).resolves.toMatchObject({
      origin: 'https://mcp.example.test',
      pathname: '/mcp',
    });
  });

  it('rejects an origin missing from the deployment allowlist', async () => {
    await expect(
      buildService({
        deploymentOrigins: 'https://other.example.test',
      }).assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).rejects.toThrow(/AI_MCP_ALLOWED_ORIGINS/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects an origin missing from the workspace allowlist', async () => {
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        'https://unrelated.example.test',
      ),
    ).rejects.toThrow(/workspace external MCP allowlist/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects every origin when the workspace allowlist is empty', async () => {
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        '',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('does not treat a shared substring as allowlist membership', async () => {
    // https://mcp.example.test and https://mcp.example.test:8443 share a prefix
    // but not an origin, so membership must be decided per parsed origin.
    await expect(
      buildService({
        deploymentOrigins: 'https://mcp.example.test:8443',
      }).assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        'https://mcp.example.test:8443',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('preserves a trailing slash because MCP endpoints may distinguish it', async () => {
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp/',
        WORKSPACE_ORIGINS,
      ),
    ).resolves.toMatchObject({ pathname: '/mcp/' });
  });
});

describe('AiMcpUrlPolicyService loopback handling', () => {
  const LOOPBACK_ORIGINS = 'http://localhost:8931';

  it('rejects a dual-allowlisted loopback origin in production', async () => {
    resolvesTo({ address: '127.0.0.1', family: 4 });
    await expect(
      buildService({
        deploymentOrigins: LOOPBACK_ORIGINS,
      }).assertAllowedForWorkspace(
        'http://localhost:8931/mcp',
        LOOPBACK_ORIGINS,
      ),
    ).rejects.toThrow(/loopback/);
  });

  it('accepts a dual-allowlisted loopback origin in development', async () => {
    resolvesTo({ address: '127.0.0.1', family: 4 });
    await expect(
      buildService({
        development: true,
        deploymentOrigins: LOOPBACK_ORIGINS,
      }).assertAllowedForWorkspace(
        'http://localhost:8931/mcp',
        LOOPBACK_ORIGINS,
      ),
    ).resolves.toMatchObject({ origin: 'http://localhost:8931' });
  });

  it('rejects an unlisted loopback origin in development', async () => {
    // The provider policy allows this through its development escape hatch.
    // requireExplicitOrigin makes that hatch unreachable for external MCP.
    await expect(
      buildService({
        development: true,
        deploymentOrigins: '',
      }).assertAllowedForWorkspace('http://127.0.0.1:8931/mcp', ''),
    ).rejects.toThrow(/AI_MCP_ALLOWED_ORIGINS/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects an IPv6 loopback literal in production', async () => {
    await expect(
      buildService({
        deploymentOrigins: 'http://[::1]:8931',
      }).assertAllowedForWorkspace(
        'http://[::1]:8931/mcp',
        'http://[::1]:8931',
      ),
    ).rejects.toThrow(/loopback/);
  });

  it('rejects an IPv4-mapped IPv6 loopback address', async () => {
    resolvesTo({ address: '::ffff:127.0.0.1', family: 6 });
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).rejects.toThrow(/loopback/);
  });

  it('rejects a hexadecimal IPv4-mapped loopback literal in production', async () => {
    const origin = 'http://[::ffff:7f00:1]:8931';
    await expect(
      buildService({ deploymentOrigins: origin }).assertAllowedForWorkspace(
        `${origin}/mcp`,
        origin,
      ),
    ).rejects.toThrow(/loopback/);
  });

  it('rejects a hostname that resolves to a mix of public and loopback addresses', async () => {
    resolvesTo(
      { address: '203.0.113.10', family: 4 },
      { address: '127.0.0.1', family: 4 },
    );
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).rejects.toThrow(/loopback/);
  });
});

describe('AiMcpUrlPolicyService address classification', () => {
  it.each([
    ['link-local IPv4', '169.254.169.254', 4, /link-local/],
    ['link-local IPv6', 'fe80::1', 6, /link-local/],
    ['mapped hexadecimal link-local IPv4', '::ffff:a9fe:a9fe', 6, /link-local/],
    ['unspecified IPv4', '0.0.0.0', 4, /unspecified/],
    ['unspecified IPv6', '::', 6, /unspecified/],
    ['multicast IPv4', '224.0.0.1', 4, /multicast/],
    ['multicast IPv6', 'ff02::1', 6, /multicast/],
    ['mapped hexadecimal multicast IPv4', '::ffff:e000:1', 6, /multicast/],
  ])(
    'rejects a hostname resolving to a %s address',
    async (_label, address, family, expected) => {
      resolvesTo({ address, family: family as 4 | 6 });
      await expect(
        buildService().assertAllowedForWorkspace(
          'https://mcp.example.test/mcp',
          WORKSPACE_ORIGINS,
        ),
      ).rejects.toThrow(expected);
    },
  );

  it('rejects a hostname that cannot be resolved', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).rejects.toThrow(/cannot be resolved/);
  });

  it('rejects a hostname that resolves to an empty address set', async () => {
    resolvesTo();
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).rejects.toThrow(/cannot be resolved/);
  });

  it('allows a dual-allowlisted private address, which is the intended approval path', async () => {
    resolvesTo({ address: '10.1.2.3', family: 4 });
    await expect(
      buildService().assertAllowedForWorkspace(
        'https://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).resolves.toMatchObject({ origin: 'https://mcp.example.test' });
  });
});

describe('AiMcpUrlPolicyService URL hygiene', () => {
  it.each([
    ['ws://mcp.example.test/mcp', /HTTP or HTTPS/],
    ['file:///etc/passwd', /HTTP or HTTPS/],
    ['not-a-url', /URL is invalid/],
  ])('rejects %s', async (rawUrl, expected) => {
    await expect(
      buildService().assertAllowedForWorkspace(rawUrl, WORKSPACE_ORIGINS),
    ).rejects.toThrow(expected);
  });

  it.each([
    ['credentials', 'https://user:secret@mcp.example.test/mcp'],
    ['a query string', 'https://mcp.example.test/mcp?token=secret'],
    ['a fragment', 'https://mcp.example.test/mcp#section'],
  ])('rejects a URL containing %s', async (_label, rawUrl) => {
    await expect(
      buildService().assertAllowedForWorkspace(rawUrl, WORKSPACE_ORIGINS),
    ).rejects.toThrow(/credentials, query, or fragment/);
  });

  it('labels errors as external MCP rather than by the raw policy kind', async () => {
    await expect(
      buildService().assertAllowedForWorkspace(
        'ws://mcp.example.test/mcp',
        WORKSPACE_ORIGINS,
      ),
    ).rejects.toThrow(/^AI external MCP /);
  });
});
