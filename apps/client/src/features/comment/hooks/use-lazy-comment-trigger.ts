import { useEffect, useRef, useState } from "react";

export const COMMENT_PREFETCH_ROOT_MARGIN = "1000px 0px";

export function useLazyCommentTrigger(activeCommentId?: string | null) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(Boolean(activeCommentId));

  useEffect(() => {
    if (activeCommentId) {
      setShouldLoad(true);
    }
  }, [activeCommentId]);

  useEffect(() => {
    if (shouldLoad) {
      return;
    }

    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: COMMENT_PREFETCH_ROOT_MARGIN },
    );
    observer.observe(target);

    return () => observer.disconnect();
  }, [shouldLoad]);

  return { targetRef, shouldLoad };
}
