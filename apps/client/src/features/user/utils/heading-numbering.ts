export function normalizeHeadingNumberingByPageId(
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

  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  ) {
    return {};
  }

  return Object.entries(parsedValue).reduce<Record<string, boolean>>(
    (acc, [pageId, enabled]) => {
      if (!pageId || typeof enabled !== "boolean") {
        return acc;
      }

      acc[pageId] = enabled;
      return acc;
    },
    {},
  );
}
