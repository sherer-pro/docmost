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
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
