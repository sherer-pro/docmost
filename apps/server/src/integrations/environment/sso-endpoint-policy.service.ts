import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EnvironmentService } from './environment.service';

@Injectable()
export class SsoEndpointPolicyService {
  constructor(private readonly environmentService: EnvironmentService) {}

  async assertAllowed(
    rawUrl: string,
    protocols: readonly string[],
    label: string,
  ): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`${label} URL is invalid`);
    }

    if (!protocols.includes(url.protocol)) {
      throw new BadRequestException(
        `${label} URL must use ${protocols.join(' or ')}`,
      );
    }
    if (url.username || url.password || url.hash) {
      throw new BadRequestException(
        `${label} URL cannot contain credentials or a fragment`,
      );
    }

    const allowedEndpoints = this.parseAllowedEndpoints(
      this.environmentService.getSsoAllowedEndpoints(),
    );
    const endpoint = this.normalizeEndpoint(url);
    const addresses = await this.resolveAddresses(url.hostname, label);
    const loopbackOnly = addresses.every((address) =>
      this.isLoopbackAddress(address),
    );

    if (
      !allowedEndpoints.has(endpoint) &&
      (!this.environmentService.isDevelopment() || !loopbackOnly)
    ) {
      throw new BadRequestException(
        `${label} endpoint is not in SSO_ALLOWED_ENDPOINTS`,
      );
    }
    if (
      addresses.some((address) => this.isLinkLocalAddress(address)) &&
      !loopbackOnly
    ) {
      throw new BadRequestException(
        `${label} URL cannot resolve to a link-local address`,
      );
    }

    return url;
  }

  private parseAllowedEndpoints(raw: string): Set<string> {
    const endpoints = new Set<string>();
    for (const value of raw.split(',')) {
      const trimmed = value.trim();
      if (!trimmed) continue;

      try {
        const url = new URL(trimmed);
        if (url.username || url.password || url.hash) continue;
        endpoints.add(this.normalizeEndpoint(url));
      } catch {
        // Invalid allowlist entries are ignored and can never grant access.
      }
    }
    return endpoints;
  }

  private normalizeEndpoint(url: URL): string {
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const defaultPort =
      protocol === 'https:'
        ? '443'
        : protocol === 'http:'
          ? '80'
          : protocol === 'ldaps:'
            ? '636'
            : protocol === 'ldap:'
              ? '389'
              : '';
    const port = url.port || defaultPort;
    return `${protocol}//${hostname}:${port}`;
  }

  private async resolveAddresses(
    hostname: string,
    label: string,
  ): Promise<string[]> {
    const normalized = hostname.replace(/^\[|\]$/g, '');
    if (isIP(normalized)) {
      return [normalized];
    }

    try {
      const addresses = await lookup(normalized, {
        all: true,
        verbatim: true,
      });
      if (addresses.length === 0) {
        throw new Error('No addresses returned');
      }
      return addresses.map((entry) => entry.address);
    } catch {
      throw new BadRequestException(`${label} hostname cannot be resolved`);
    }
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
