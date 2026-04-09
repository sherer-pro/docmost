interface PageWidthPreferences {
  fullPageWidth?: boolean;
  fullPageWidthByPageId?: Record<string, boolean>;
}

interface ResolvePageFullWidthInput {
  pageId?: string | null;
  preferences?: PageWidthPreferences | null;
}

export function resolvePageFullWidth({
  pageId,
  preferences,
}: ResolvePageFullWidthInput): boolean {
  const pageWidthOverrides = preferences?.fullPageWidthByPageId;

  if (
    pageId &&
    pageWidthOverrides &&
    Object.prototype.hasOwnProperty.call(pageWidthOverrides, pageId)
  ) {
    return Boolean(pageWidthOverrides[pageId]);
  }

  return preferences?.fullPageWidth ?? false;
}
