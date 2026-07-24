/**
 * Mirrors the server's `@IsUrl` check (validator.js, require_tld: true by
 * default) so the client rejects hosts like "localhost" or "intranet" before
 * they ever reach the API - the browser's URL parser alone accepts those.
 */
function hasRoutableHost(hostname: string): boolean {
  if (!hostname) {
    return false;
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return true; // IPv6 literal
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return true; // IPv4 literal
  }
  const lastLabel = hostname.slice(hostname.lastIndexOf(".") + 1);
  return hostname.includes(".") && /^[a-z]{2,63}$/i.test(lastLabel);
}

/**
 * Only http(s) links are allowed for space custom links. This guards the
 * sidebar render and the settings form against unsafe schemes such as
 * javascript: or data:.
 */
export function isSafeCustomLinkUrl(url: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      hasRoutableHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}
