const LOG_URL_BASE = 'http://log.invalid';

/**
 * Keeps a request path and query parameter names while removing all values,
 * URL credentials, origins, and fragments from diagnostic output.
 */
export function sanitizeUrlForLogging(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string') {
    return undefined;
  }

  const normalizedUrl = rawUrl.trim();
  if (!normalizedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedUrl, LOG_URL_BASE);
    const queryKeys = Array.from(new Set(parsedUrl.searchParams.keys()));
    const query = queryKeys.map((key) => encodeURIComponent(key)).join('&');

    return `${parsedUrl.pathname}${query ? `?${query}` : ''}`;
  } catch {
    const pathEnd = normalizedUrl.search(/[?#]/);
    return pathEnd >= 0 ? normalizedUrl.slice(0, pathEnd) : normalizedUrl;
  }
}
