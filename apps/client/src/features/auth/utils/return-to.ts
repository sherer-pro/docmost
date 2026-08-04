const DEFAULT_RETURN_TO = "/home";

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function sanitizeRelativeReturnTo(
  value: string | null | undefined,
  fallback = DEFAULT_RETURN_TO,
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) {
    return fallback;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    hasControlCharacters(decoded)
  ) {
    return fallback;
  }

  return value;
}

export function getSpaceReturnTo(spaceSlug?: string): string {
  return spaceSlug
    ? `/s/${encodeURIComponent(spaceSlug)}`
    : DEFAULT_RETURN_TO;
}

export function getTargetedLoginUrl(spaceSlug?: string): string {
  if (!spaceSlug) {
    return "/login";
  }

  const params = new URLSearchParams({
    spaceSlug,
    returnTo: getSpaceReturnTo(spaceSlug),
  });
  return `/login?${params}`;
}
