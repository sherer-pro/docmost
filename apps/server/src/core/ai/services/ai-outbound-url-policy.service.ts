import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

export interface AiOutboundUrlPolicy {
  kind: 'provider' | 'retrieval' | 'rag-sync' | 'mcp';
  allowedOrigins: string;
  allowQuery: boolean;
  trimTrailingSlash?: boolean;
  /**
   * A second allowlist the origin must also belong to. External MCP requires
   * both a deployment allowlist and a workspace allowlist to name the origin.
   */
  secondaryAllowedOrigins?: string;
  secondaryAllowlistLabel?: string;
  /**
   * Reject an origin that is absent from the allowlist even in development.
   * This makes the development loopback escape hatch structurally unreachable
   * instead of leaving it to be reasoned about.
   */
  requireExplicitOrigin?: boolean;
  /** Reject loopback addresses even when the origin is allowlisted. */
  denyLoopback?: boolean;
}

export type AiResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type AiResolvedOutboundUrl = {
  url: URL;
  addresses: AiResolvedAddress[];
};

function parseIpv4Octets(value: string): number[] | null {
  const octets = value.split('.');
  if (octets.length !== 4) {
    return null;
  }
  const parsed = octets.map((octet) => Number(octet));
  return parsed.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? parsed
    : null;
}

/** Expands an IPv6 literal to eight words without accepting non-IP text. */
function parseIpv6Words(address: string): number[] | null {
  let normalized = address.toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex >= 0) {
    normalized = normalized.slice(0, zoneIndex);
  }

  const doubleColon = normalized.indexOf('::');
  if (doubleColon !== -1 && doubleColon !== normalized.lastIndexOf('::')) {
    return null;
  }

  const parseSide = (side: string): number[] | null => {
    if (!side) {
      return [];
    }
    const parts = side.split(':');
    const words: number[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part.includes('.')) {
        if (index !== parts.length - 1) {
          return null;
        }
        const octets = parseIpv4Octets(part);
        if (!octets) {
          return null;
        }
        words.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) {
        return null;
      }
      words.push(Number.parseInt(part, 16));
    }
    return words;
  };

  const left = parseSide(
    doubleColon === -1 ? normalized : normalized.slice(0, doubleColon),
  );
  const right = parseSide(
    doubleColon === -1 ? '' : normalized.slice(doubleColon + 2),
  );
  if (!left || !right) {
    return null;
  }
  if (doubleColon === -1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array(missing).fill(0), ...right] : null;
}

function unwrapMappedIpv4(address: string): string {
  const normalized = address.toLowerCase();
  const words = parseIpv6Words(normalized);
  if (
    !words ||
    words.length !== 8 ||
    words.slice(0, 5).some((word) => word !== 0) ||
    words[5] !== 0xffff
  ) {
    return normalized;
  }
  return [
    words[6] >> 8,
    words[6] & 0xff,
    words[7] >> 8,
    words[7] & 0xff,
  ].join('.');
}

export function isAiLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::1' || unwrapMappedIpv4(normalized).startsWith('127.');
}

export function isAiLinkLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }
  return unwrapMappedIpv4(normalized).startsWith('169.254.');
}

export function isAiUnspecifiedAddress(address: string): boolean {
  const normalized = unwrapMappedIpv4(address);
  return normalized === '::' || normalized === '0.0.0.0';
}

export function isAiMulticastAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('ff')) {
    return true;
  }
  const firstOctet = Number(unwrapMappedIpv4(normalized).split('.')[0]);
  return Number.isInteger(firstOctet) && firstOctet >= 224 && firstOctet <= 239;
}

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
    const label = this.labelFor(policy.kind);
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

    const inPrimaryAllowlist = this.parseOrigins(policy.allowedOrigins).has(
      url.origin,
    );
    // Membership is decided per allowlist with the same origin normalization.
    // The raw strings are never concatenated or intersected: two spellings of
    // one origin share a URL.origin but not a substring.
    const inSecondaryAllowlist =
      policy.secondaryAllowedOrigins === undefined ||
      this.parseOrigins(policy.secondaryAllowedOrigins).has(url.origin);
    const addresses = await this.resolveAddresses(url.hostname, label);
    const loopbackOnly =
      addresses.length > 0 &&
      addresses.every((entry) => isAiLoopbackAddress(entry.address));

    if (
      !inPrimaryAllowlist &&
      (policy.requireExplicitOrigin ||
        !this.environmentService.isDevelopment() ||
        !loopbackOnly)
    ) {
      throw new BadRequestException(
        `${label} origin is not in ${this.allowlistName(policy.kind)}`,
      );
    }
    if (!inSecondaryAllowlist) {
      throw new BadRequestException(
        `${label} origin is not in ${
          policy.secondaryAllowlistLabel ?? 'the secondary allowlist'
        }`,
      );
    }
    if (
      policy.denyLoopback &&
      addresses.some((entry) => isAiLoopbackAddress(entry.address))
    ) {
      throw new BadRequestException(
        `${label} URL cannot resolve to a loopback address`,
      );
    }
    if (
      addresses.some((entry) => isAiLinkLocalAddress(entry.address)) &&
      !loopbackOnly
    ) {
      throw new BadRequestException(
        `${label} URL cannot resolve to a link-local address`,
      );
    }
    if (addresses.some((entry) => isAiUnspecifiedAddress(entry.address))) {
      throw new BadRequestException(
        `${label} URL cannot resolve to an unspecified address`,
      );
    }
    if (addresses.some((entry) => isAiMulticastAddress(entry.address))) {
      throw new BadRequestException(
        `${label} URL cannot resolve to a multicast address`,
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

  private labelFor(kind: AiOutboundUrlPolicy['kind']): string {
    if (kind === 'mcp') return 'AI external MCP';
    if (kind === 'rag-sync') return 'RAG sync';
    return `AI ${kind}`;
  }

  private allowlistName(kind: AiOutboundUrlPolicy['kind']): string {
    if (kind === 'provider') {
      return 'AI_PROVIDER_ALLOWED_ORIGINS';
    }
    if (kind === 'rag-sync') {
      return 'RAG_SYNC_ALLOWED_ORIGINS';
    }
    return kind === 'mcp'
      ? 'AI_MCP_ALLOWED_ORIGINS'
      : 'AI_RETRIEVAL_ALLOWED_ORIGINS';
  }
}
