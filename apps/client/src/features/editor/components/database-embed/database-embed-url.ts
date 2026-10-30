export function parseDatabaseEmbedUrl(
  value: string,
  origin = window.location.origin,
): { pageSlug: string; viewId?: string } | null {
  try {
    const url = new URL(value, origin);
    const match = /^\/s\/[^/]+\/db\/([^/]+)\/?$/.exec(url.pathname);
    if (url.origin !== origin || !match) return null;
    const viewId = url.searchParams.get("viewId") ?? undefined;
    if (viewId && !/^[a-f0-9-]{36}$/i.test(viewId)) return null;
    return { pageSlug: decodeURIComponent(match[1]), viewId };
  } catch {
    return null;
  }
}
