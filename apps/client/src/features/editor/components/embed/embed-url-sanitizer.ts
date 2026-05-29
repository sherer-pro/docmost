import {
  getEmbedFrameSources,
  isEmbedFrameSourceAllowed,
  parseEmbedAllowedOrigins,
  sanitizeUrl,
} from '@docmost/editor-ext';
import { getDrawioUrl, getEmbedAllowedOrigins } from '@/lib/config';

function isHttpEmbedUrl(url: string): boolean {
  if (!/^(https?:)?\/\//i.test(url)) {
    return false;
  }

  const parsedUrl = new URL(url, 'https://docmost.invalid');
  return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
}

export function sanitizeEmbedUrl(url: string | null | undefined): string {
  const sanitized = sanitizeUrl(url ?? undefined);

  if (url?.trim() && !sanitized) {
    const schemeMatch = url.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    const scheme = schemeMatch?.[1]?.toLowerCase() ?? 'unknown';

    console.warn('[security][embed-url-rejected]', { scheme });
  }

  if (sanitized && !isHttpEmbedUrl(sanitized)) {
    console.warn('[security][embed-url-rejected]', { scheme: 'relative' });
    return '';
  }

  return sanitized;
}

function getUrlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function sanitizeEmbedUrlForProvider(
  url: string | null | undefined,
  providerId?: string,
): string {
  const sanitized = sanitizeEmbedUrl(url);

  if (!sanitized) {
    return '';
  }

  const frameSources =
    providerId === 'iframe'
      ? parseEmbedAllowedOrigins(getEmbedAllowedOrigins())
      : getEmbedFrameSources(getEmbedAllowedOrigins(), getDrawioUrl());

  if (!isEmbedFrameSourceAllowed(sanitized, frameSources)) {
    console.warn('[security][embed-url-rejected]', {
      scheme: 'origin-not-allowed',
      origin: getUrlOrigin(sanitized),
    });
    return '';
  }

  return sanitized;
}
