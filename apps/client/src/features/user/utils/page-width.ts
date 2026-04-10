interface PageWidthPreferences {
  fullPageWidth?: boolean;
  fullPageWidthByPageId?: unknown;
}

interface ResolvePageFullWidthInput {
  pageId?: string | null;
  preferences?: PageWidthPreferences | null;
}

export function resolvePageFullWidth({
  pageId,
  preferences,
}: ResolvePageFullWidthInput): boolean {
  const pageWidthOverrides = normalizeFullPageWidthByPageId(
    preferences?.fullPageWidthByPageId,
  );

  if (
    pageId &&
    Object.prototype.hasOwnProperty.call(pageWidthOverrides, pageId)
  ) {
    return Boolean(pageWidthOverrides[pageId]);
  }

  return preferences?.fullPageWidth ?? false;
}

export function normalizeFullPageWidthByPageId(
  value: unknown,
): Record<string, boolean> {
  let parsedValue = value;

  if (typeof parsedValue === "string") {
    try {
      parsedValue = JSON.parse(parsedValue);
    } catch {
      return {};
    }
  }

  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
    return {};
  }

  return Object.entries(parsedValue).reduce<Record<string, boolean>>(
    (acc, [pageId, isFullWidth]) => {
      if (!pageId || typeof isFullWidth !== "boolean") {
        return acc;
      }

      acc[pageId] = isFullWidth;
      return acc;
    },
    {},
  );
}
