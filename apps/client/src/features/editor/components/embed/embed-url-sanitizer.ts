import { sanitizeUrl } from '@docmost/editor-ext';

export function sanitizeEmbedUrl(url: string | undefined): string {
  const sanitized = sanitizeUrl(url);

  if (url?.trim() && !sanitized) {
    const schemeMatch = url.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    const scheme = schemeMatch?.[1]?.toLowerCase() ?? 'unknown';

    console.warn('[security][embed-url-rejected]', { scheme });
  }

  return sanitized;
}
