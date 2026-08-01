import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

export interface AiOutboundUrlPolicy {
  kind: 'provider' | 'retrieval';
  allowedOrigins: string;
  allowQuery: boolean;
  trimTrailingSlash?: boolean;
}

export type AiResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type AiResolvedOutboundUrl = {
  url: URL;
  addresses: AiResolvedAddress[];
};

@Injectable()
export class AiOutboundUrlPolicyService {
  constructor(private readonly environmentService: EnvironmentService) {}

  async assertAllowed(
    rawUrl: string,
    policy: AiOutboundUrlPolicy,
  ): Promise<URL> {
    return (await this.resolveAllowed(rawUrl, policy)).url;
  }

  async resolveAllowed(
    rawUrl: string,
    policy: AiOutboundUrlPolicy,
  ): Promise<AiResolvedOutboundUrl> {
    const label = `AI ${policy.kind}`;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`${label} URL is invalid`);
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException(`${label} URL must use HTTP or HTTPS`);
    }
    if (
      url.username ||
      url.password ||
      url.hash ||
      (!policy.allowQuery && url.search)
    ) {
      const suffix = policy.allowQuery
        ? 'credentials or fragment'
        : 'credentials, query, or fragment';
      throw new BadRequestException(`${label} URL cannot contain ${suffix}`);
    }

    const explicitlyAllowed = this.parseOrigins(policy.allowedOrigins).has(
      url.origin,
    );
    const addresses = await this.resolveAddresses(url.hostname, label);
    const loopbackOnly =
      addresses.length > 0 &&
      addresses.every((entry) => this.isLoopbackAddress(entry.address));

    if (
      !explicitlyAllowed &&
      (!this.environmentService.isDevelopment() || !loopbackOnly)
    ) {
      throw new BadRequestException(
        `${label} origin is not in ${this.allowlistName(policy.kind)}`,
      );
    }
    if (
      addresses.some((entry) => this.isLinkLocalAddress(entry.address)) &&
      !loopbackOnly
    ) {
      throw new BadRequestException(
        `${label} URL cannot resolve to a link-local address`,
      );
    }

    if (policy.trimTrailingSlash) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return { url, addresses };
  }

  private parseOrigins(raw: string): Set<string> {
    return new Set(
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
          try {
            return new URL(origin).origin;
          } catch {
            return '';
          }
        })
        .filter(Boolean),
    );
  }

  private async resolveAddresses(
    hostname: string,
    label: string,
  ): Promise<AiResolvedAddress[]> {
    const normalized = hostname.replace(/^\[|\]$/g, '');
    const literalFamily = isIP(normalized);
    if (literalFamily === 4 || literalFamily === 6) {
      return [{ address: normalized, family: literalFamily }];
    }

    try {
      const addresses = await lookup(normalized, {
        all: true,
        verbatim: true,
      });
      if (addresses.length === 0) {
        throw new Error('No addresses returned');
      }
      return addresses.map((entry) => ({
        address: entry.address,
        family: entry.family === 6 ? 6 : 4,
      }));
    } catch {
      throw new BadRequestException(`${label} hostname cannot be resolved`);
    }
  }

  private allowlistName(kind: AiOutboundUrlPolicy['kind']): string {
    return kind === 'provider'
      ? 'AI_PROVIDER_ALLOWED_ORIGINS'
      : 'AI_RETRIEVAL_ALLOWED_ORIGINS';
  }

  private isLoopbackAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return normalized === '::1' || (mapped ?? normalized).startsWith('127.');
  }

  private isLinkLocalAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    if (/^fe[89ab]/.test(normalized)) {
      return true;
    }
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return (mapped ?? normalized).startsWith('169.254.');
  }
}
