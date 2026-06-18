import { BadRequestException, Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const LINK_PREVIEW_TIMEOUT_MS = 7000;
const LINK_PREVIEW_MAX_REDIRECTS = 5;
const LINK_PREVIEW_MAX_RESPONSE_BYTES = 1_000_000;
const LINK_PREVIEW_BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
];

type LinkPreviewAddress = {
  address: string;
  family: 4 | 6;
};

type LinkPreviewResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
};

export type LinkPreviewResult = {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
};

function buildLinkPreviewBlockList(): BlockList {
  const blockList = new BlockList();

  // Private, local, and non-routable IPv4 ranges.
  blockList.addSubnet('0.0.0.0', 8, 'ipv4');
  blockList.addSubnet('10.0.0.0', 8, 'ipv4');
  blockList.addSubnet('100.64.0.0', 10, 'ipv4');
  blockList.addSubnet('127.0.0.0', 8, 'ipv4');
  blockList.addSubnet('169.254.0.0', 16, 'ipv4');
  blockList.addSubnet('172.16.0.0', 12, 'ipv4');
  blockList.addSubnet('192.0.0.0', 24, 'ipv4');
  blockList.addSubnet('192.0.2.0', 24, 'ipv4');
  blockList.addSubnet('192.88.99.0', 24, 'ipv4');
  blockList.addSubnet('192.168.0.0', 16, 'ipv4');
  blockList.addSubnet('198.18.0.0', 15, 'ipv4');
  blockList.addSubnet('198.51.100.0', 24, 'ipv4');
  blockList.addSubnet('203.0.113.0', 24, 'ipv4');
  blockList.addSubnet('224.0.0.0', 4, 'ipv4');
  blockList.addSubnet('240.0.0.0', 4, 'ipv4');
  blockList.addAddress('255.255.255.255', 'ipv4');

  // Local and reserved IPv6 ranges.
  blockList.addAddress('::', 'ipv6');
  blockList.addAddress('::1', 'ipv6');
  blockList.addSubnet('fc00::', 7, 'ipv6');
  blockList.addSubnet('fe80::', 10, 'ipv6');
  blockList.addSubnet('ff00::', 8, 'ipv6');
  blockList.addSubnet('2001:db8::', 32, 'ipv6');

  return blockList;
}

const LINK_PREVIEW_BLOCKLIST = buildLinkPreviewBlockList();

@Injectable()
export class LinkPreviewService {
  async getPreview(url: string): Promise<LinkPreviewResult> {
    let sourceUrl: URL;

    try {
      sourceUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
      throw new BadRequestException('Only HTTP and HTTPS URLs are supported');
    }

    const { finalUrl, html } = await this.fetchHtml(sourceUrl);
    const $ = load(html);
    const finalUrlString = finalUrl.toString();
    const title =
      this.getBestMetaContent($, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) ||
      $('title').first().text().trim() ||
      finalUrl.hostname;
    const description = this.getBestMetaContent($, [
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]);
    const image = this.getAbsoluteUrl(
      finalUrlString,
      this.getBestMetaContent($, [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="twitter:image"]',
      ]),
    );
    const favicon = this.getBestFaviconUrl($, finalUrlString);

    return {
      url: finalUrlString,
      title,
      description,
      image: image || favicon || null,
      siteName:
        this.getBestMetaContent($, [
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
        ]) || finalUrl.hostname,
    };
  }

  private async fetchHtml(
    sourceUrl: URL,
  ): Promise<{ finalUrl: URL; html: string }> {
    let currentUrl = new URL(sourceUrl.toString());

    for (let hop = 0; hop <= LINK_PREVIEW_MAX_REDIRECTS; hop += 1) {
      const targetAddress = await this.resolvePublicUrlAddress(currentUrl);

      const response = await this.requestLinkPreview(
        currentUrl,
        targetAddress,
      ).catch(() => {
        throw new BadRequestException('Failed to fetch URL metadata');
      });

      if (this.isRedirectResponse(response.statusCode)) {
        response.body.resume();
        const location = this.getHeaderValue(response.headers, 'location');
        if (!location) {
          throw new BadRequestException('Failed to fetch URL metadata');
        }

        try {
          currentUrl = new URL(location, currentUrl);
        } catch {
          throw new BadRequestException('Failed to fetch URL metadata');
        }

        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.resume();
        throw new BadRequestException('Failed to fetch URL metadata');
      }

      const contentType =
        this.getHeaderValue(response.headers, 'content-type')?.toLowerCase() ??
        '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        response.body.resume();
        throw new BadRequestException('URL does not point to an HTML document');
      }

      const html = await this.readIncomingMessageWithLimit(
        response.body,
        LINK_PREVIEW_MAX_RESPONSE_BYTES,
      );

      return { finalUrl: currentUrl, html };
    }

    throw new BadRequestException('Too many redirects');
  }

  private async resolvePublicUrlAddress(url: URL): Promise<LinkPreviewAddress> {
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Only HTTP and HTTPS URLs are supported');
    }

    if (this.isBlockedHostname(url.hostname)) {
      throw new BadRequestException('Unsafe target URL');
    }

    const hostIpVersion = isIP(url.hostname);
    if (hostIpVersion !== 0) {
      if (this.isBlockedIpAddress(url.hostname)) {
        throw new BadRequestException('Unsafe target URL');
      }

      return {
        address: this.normalizeIpAddress(url.hostname),
        family: hostIpVersion as 4 | 6,
      };
    }

    const resolvedAddresses = await dnsLookup(url.hostname, {
      all: true,
      verbatim: true,
    }).catch(() => {
      throw new BadRequestException('Failed to resolve URL hostname');
    });

    if (resolvedAddresses.length === 0) {
      throw new BadRequestException('Failed to resolve URL hostname');
    }

    if (
      resolvedAddresses.some((entry) => this.isBlockedIpAddress(entry.address))
    ) {
      throw new BadRequestException('Unsafe target URL');
    }

    const targetAddress = resolvedAddresses.find(
      (entry) => entry.family === 4 || entry.family === 6,
    );

    if (!targetAddress) {
      throw new BadRequestException('Failed to resolve URL hostname');
    }

    return {
      address: targetAddress.address,
      family: targetAddress.family as 4 | 6,
    };
  }

  private requestLinkPreview(
    url: URL,
    targetAddress: LinkPreviewAddress,
  ): Promise<LinkPreviewResponse> {
    return new Promise((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          headers: {
            'user-agent':
              'Mozilla/5.0 (compatible; DocmostBot/1.0; +https://docmost.com)',
            accept: 'text/html,application/xhtml+xml',
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, targetAddress.address, targetAddress.family);
          },
          timeout: LINK_PREVIEW_TIMEOUT_MS,
        },
        (body) => {
          resolve({
            statusCode: body.statusCode ?? 0,
            headers: body.headers,
            body,
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('Link preview request timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private getHeaderValue(
    headers: IncomingHttpHeaders,
    name: string,
  ): string | null {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
  }

  private isBlockedHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/\.$/, '');
    return (
      normalized === 'localhost' ||
      LINK_PREVIEW_BLOCKED_HOST_SUFFIXES.some((suffix) =>
        normalized.endsWith(suffix),
      )
    );
  }

  private isBlockedIpAddress(address: string): boolean {
    const normalized = this.normalizeIpAddress(address);

    if (normalized.toLowerCase().startsWith('::ffff:')) {
      const mappedIpv4 = normalized.slice('::ffff:'.length);
      if (isIP(mappedIpv4) === 4) {
        return this.isBlockedIpAddress(mappedIpv4);
      }
    }

    const family = isIP(normalized);
    if (family === 0) {
      return true;
    }

    return LINK_PREVIEW_BLOCKLIST.check(
      normalized,
      family === 4 ? 'ipv4' : 'ipv6',
    );
  }

  private normalizeIpAddress(address: string): string {
    return address.replace(/^\[|\]$/g, '').split('%')[0];
  }

  private isRedirectResponse(statusCode: number): boolean {
    return [301, 302, 303, 307, 308].includes(statusCode);
  }

  private async readIncomingMessageWithLimit(
    response: IncomingMessage,
    maxBytes: number,
  ): Promise<string> {
    const contentLength = Number(
      this.getHeaderValue(response.headers, 'content-length'),
    );
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new BadRequestException('URL metadata response is too large');
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of response) {
      if (!chunk) {
        continue;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        response.destroy();
        throw new BadRequestException('URL metadata response is too large');
      }

      chunks.push(buffer);
    }

    return Buffer.concat(chunks).toString('utf8');
  }

  private getAbsoluteUrl(baseUrl: string, value?: string): string | null {
    if (!value) {
      return null;
    }

    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return null;
    }
  }

  private getBestMetaContent(
    $: ReturnType<typeof load>,
    selectors: string[],
  ): string {
    for (const selector of selectors) {
      const value = $(selector).attr('content')?.trim();
      if (value) {
        return value;
      }
    }

    return '';
  }

  private getIconArea(sizeValue?: string): number {
    if (!sizeValue) {
      return 0;
    }

    const normalized = sizeValue.toLowerCase();
    if (normalized.includes('any')) {
      return Number.MAX_SAFE_INTEGER;
    }

    return normalized
      .split(/\s+/)
      .map((item) => item.trim())
      .reduce((maxArea, item) => {
        const match = item.match(/^(\d+)x(\d+)$/);
        if (!match) {
          return maxArea;
        }

        const width = Number(match[1]);
        const height = Number(match[2]);

        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          return maxArea;
        }

        return Math.max(maxArea, width * height);
      }, 0);
  }

  private getIconRelPriority(relValue?: string): number {
    if (!relValue) {
      return 0;
    }

    const relTokens = relValue
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (
      relTokens.includes('apple-touch-icon') ||
      relTokens.includes('apple-touch-icon-precomposed')
    ) {
      return 3;
    }

    if (relTokens.includes('icon') && relTokens.includes('shortcut')) {
      return 2;
    }

    if (relTokens.includes('icon')) {
      return 1;
    }

    if (relTokens.includes('mask-icon')) {
      return 1;
    }

    return 0;
  }

  private getBestFaviconUrl(
    $: ReturnType<typeof load>,
    pageUrl: string,
  ): string {
    let bestUrl = '';
    let bestArea = -1;
    let bestPriority = -1;

    $('link[rel]').each((_, element) => {
      const rel = $(element).attr('rel')?.trim();
      const priority = this.getIconRelPriority(rel);

      if (priority === 0) {
        return;
      }

      const href = $(element).attr('href')?.trim();
      const absoluteHref = this.getAbsoluteUrl(pageUrl, href);
      if (!absoluteHref) {
        return;
      }

      const area = this.getIconArea($(element).attr('sizes')?.trim());
      const shouldReplace =
        area > bestArea || (area === bestArea && priority > bestPriority);

      if (!shouldReplace) {
        return;
      }

      bestArea = area;
      bestPriority = priority;
      bestUrl = absoluteHref;
    });

    return bestUrl;
  }
}
