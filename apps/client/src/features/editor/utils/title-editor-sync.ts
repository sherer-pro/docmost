export interface FocusSafeSyncParams {
  entityId: string;
  lastSyncedEntityId: string;
  nextTitle: string;
  currentTitle: string;
  isFocused: boolean;
  hasCollapsedSelection: boolean;
}

/**
 * Determines whether external title value can safely replace the editor content.
 *
 * The function keeps typing stable by ignoring external updates when:
 * - we are still on the same entity;
 * - editor has focus;
 * - selection is collapsed (caret typing mode).
 */
export function shouldApplyFocusSafeTitleSync({
  entityId,
  lastSyncedEntityId,
  nextTitle,
  currentTitle,
  isFocused,
  hasCollapsedSelection,
}: FocusSafeSyncParams): boolean {
  if (nextTitle === currentTitle) {
    return false;
  }

  const isEntityChanged = entityId !== lastSyncedEntityId;

  if (!isEntityChanged && isFocused && hasCollapsedSelection) {
    return false;
  }

  return true;
}

/**
 * Decides whether URL should switch to a canonical slug immediately.
 *
 * While title is actively edited, URL synchronization is intentionally deferred
 * to avoid browser history churn and intermediate remount effects.
 */
export function shouldNavigateToCanonicalSlug(
  currentSlugId: string | undefined,
  nextSlugId: string | undefined,
  isTitleEditing: boolean,
): boolean {
  if (!currentSlugId || !nextSlugId) {
    return false;
  }

  if (currentSlugId === nextSlugId) {
    return false;
  }

  return !isTitleEditing;
}
