import { useCallback, useRef } from "react";

export interface CanonicalTitleUrlSyncParams {
  currentUrl: string;
  nextUrl: string;
}

/**
 * Решает, можно ли сразу синхронизировать адрес с canonical URL.
 *
 * Во время активного ввода в title-редакторе синхронизация откладывается,
 * чтобы не создавать лишние replace-навигации и не сбрасывать фокус.
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
 * Общий helper для синхронизации canonical URL при rename.
 *
 * Алгоритм единый для page/database title editors:
 * 1) если пользователь печатает, откладываем переход;
 * 2) если фокус ушёл, применяем последний отложенный canonical URL;
 * 3) если URL уже совпадает, сбрасываем pending-состояние.
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
