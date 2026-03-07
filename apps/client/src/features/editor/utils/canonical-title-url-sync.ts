import { useCallback, useRef } from "react";

export interface CanonicalTitleUrlSyncParams {
  currentUrl: string;
  nextUrl: string;
}

/**
 * Decides whether canonical URL sync can happen immediately.
 *
 * While title editor is actively focused, sync is deferred to avoid
 * extra replace navigations and focus resets.
 */
export function shouldSyncCanonicalUrlNow(
  currentUrl: string,
  nextUrl: string,
  isTitleEditing: boolean,
): boolean {
  if (!currentUrl || !nextUrl) {
    return false;
  }

  if (currentUrl === nextUrl) {
    return false;
  }

  return !isTitleEditing;
}

/**
 * Shared helper for canonical URL sync during rename.
 *
 * Unified algorithm for page/database title editors:
 * 1) defer navigation while user is typing;
 * 2) apply the last deferred URL when focus is lost;
 * 3) clear pending state when URL is already canonical.
 */
export function useDeferredCanonicalTitleUrlSync(
  applyCanonicalUrl: (nextUrl: string) => void,
) {
  const isTitleEditingRef = useRef(false);
  const pendingCanonicalUrlRef = useRef<string | null>(null);

  const syncCanonicalUrl = useCallback(
    ({ currentUrl, nextUrl }: CanonicalTitleUrlSyncParams) => {
      const shouldSyncNow = shouldSyncCanonicalUrlNow(
        currentUrl,
        nextUrl,
        isTitleEditingRef.current,
      );

      if (shouldSyncNow) {
        pendingCanonicalUrlRef.current = null;
        applyCanonicalUrl(nextUrl);
        return;
      }

      if (currentUrl === nextUrl) {
        pendingCanonicalUrlRef.current = null;
        return;
      }

      pendingCanonicalUrlRef.current = nextUrl;
    },
    [applyCanonicalUrl],
  );

  const onTitleFocusChange = useCallback(
    (isFocused: boolean) => {
      isTitleEditingRef.current = isFocused;

      if (isFocused || !pendingCanonicalUrlRef.current) {
        return;
      }

      const deferredUrl = pendingCanonicalUrlRef.current;
      pendingCanonicalUrlRef.current = null;
      applyCanonicalUrl(deferredUrl);
    },
    [applyCanonicalUrl],
  );

  return {
    syncCanonicalUrl,
    onTitleFocusChange,
  };
}
