export const DEFAULT_EMBED_FRAME_SOURCES = [
  "https://loom.com",
  "https://www.loom.com",
  "https://airtable.com",
  "https://www.airtable.com",
  "https://www.figma.com",
  "https://miro.com",
  "https://www.miro.com",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://framer.com",
  "https://www.framer.com",
  "https://drive.google.com",
  "https://docs.google.com",
  "https://typeform.com",
  "https://*.typeform.com",
  "https://embed.diagrams.net",
] as const;

const HTTP_FRAME_PROTOCOLS = new Set(["http:", "https:"]);

function toHttpOrigin(value: string): string | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    if (!HTTP_FRAME_PROTOCOLS.has(parsedUrl.protocol)) {
      return null;
    }

    return parsedUrl.origin;
  } catch {
    return null;
  }
}

export function parseEmbedAllowedOrigins(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  const origins = value
    .split(",")
    .map(toHttpOrigin)
    .filter((origin): origin is string => Boolean(origin));

  return [...new Set(origins)];
}

export function getEmbedFrameSources(
  ...customOriginValues: Array<string | null | undefined>
): string[] {
  const sources = new Set<string>(DEFAULT_EMBED_FRAME_SOURCES);

  for (const value of customOriginValues) {
    for (const origin of parseEmbedAllowedOrigins(value)) {
      sources.add(origin);
    }
  }

  return [...sources];
}

function matchesWildcardFrameSource(url: URL, frameSource: string): boolean {
  const match = frameSource.match(/^(https?):\/\/\*\.([^/]+)$/);
  if (!match) {
    return false;
  }

  const [, protocol, baseHostname] = match;

  return (
    url.protocol === `${protocol}:` &&
    url.hostname !== baseHostname &&
    url.hostname.endsWith(`.${baseHostname}`)
  );
}

export function isEmbedFrameSourceAllowed(
  value: string,
  frameSources: string[] = getEmbedFrameSources(),
): boolean {
  try {
    const parsedUrl = new URL(value);
    if (!HTTP_FRAME_PROTOCOLS.has(parsedUrl.protocol)) {
      return false;
    }

    return frameSources.some(
      (frameSource) =>
        frameSource === parsedUrl.origin ||
        matchesWildcardFrameSource(parsedUrl, frameSource),
    );
  } catch {
    return false;
  }
}
