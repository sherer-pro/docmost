export const TRUSTED_EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups";
export const GENERIC_IFRAME_SANDBOX =
  "allow-scripts allow-forms allow-popups";

export function getEmbedIframeSandbox(providerId?: string): string {
  return providerId === "iframe"
    ? GENERIC_IFRAME_SANDBOX
    : TRUSTED_EMBED_SANDBOX;
}
