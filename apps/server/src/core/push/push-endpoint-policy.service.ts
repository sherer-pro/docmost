import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { EnvironmentService } from '../../integrations/environment/environment.service';

const excludedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  excludedV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const excludedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  excludedV6.addSubnet(address, prefix, 'ipv6');

export function isPublicPushAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !excludedV4.check(address, 'ipv4')
    : family === 6 &&
        !address.includes('%') &&
        globalV6.check(address, 'ipv6') &&
        !excludedV6.check(address, 'ipv6');
}

export interface ResolvedPushEndpoint {
  url: URL;
  address: string;
  family: 4 | 6;
}

@Injectable()
export class PushEndpointPolicyService {
  constructor(private readonly environment: EnvironmentService) {}

  isConfigured(): boolean {
    return this.allowedOrigins().size > 0;
  }

  private allowedOrigins(): Set<string> {
    const origins = new Set<string>();
    for (const entry of this.environment
      .getWebPushAllowedOrigins()
      .split(',')) {
      try {
        const url = new URL(entry.trim());
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === '/'
        )
          origins.add(url.origin);
      } catch {
        // Invalid entries never grant access.
      }
    }
    return origins;
  }

  async assertAllowed(endpoint: string): Promise<ResolvedPushEndpoint> {
    const denied = () =>
      new BadRequestException({
        code: 'push_endpoint_not_allowed',
        message: 'Push notification provider is not allowed',
      });
    let url: URL;
    try {
      if (typeof endpoint !== 'string' || endpoint.length > 2048)
        throw denied();
      url = new URL(endpoint);
    } catch {
      throw denied();
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      !this.allowedOrigins().has(url.origin)
    )
      throw denied();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: Array<{ address: string; family: number }>;
    try {
      const family = isIP(hostname);
      addresses = family
        ? [{ address: hostname, family }]
        : await lookup(hostname, { all: true, verbatim: true });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EAI_AGAIN'
      ) {
        throw Object.assign(
          new ServiceUnavailableException(
            'Push notification provider is temporarily unavailable',
          ),
          { code: 'EAI_AGAIN' },
        );
      }
      throw denied();
    }
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicPushAddress(address))
    ) {
      throw denied();
    }
    return {
      url,
      address: addresses[0].address,
      family: addresses[0].family as 4 | 6,
    };
  }
}
