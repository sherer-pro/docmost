export function sameOpenWebUiTarget(
  leftBaseUrl: string | null | undefined,
  leftKnowledgeId: string | null | undefined,
  rightBaseUrl: string | null | undefined,
  rightKnowledgeId: string | null | undefined,
): boolean {
  const leftOrigin = normalizeOrigin(leftBaseUrl);
  const rightOrigin = normalizeOrigin(rightBaseUrl);
  return Boolean(
    leftOrigin &&
      leftOrigin === rightOrigin &&
      leftKnowledgeId?.trim() &&
      leftKnowledgeId.trim() === rightKnowledgeId?.trim(),
  );
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}
