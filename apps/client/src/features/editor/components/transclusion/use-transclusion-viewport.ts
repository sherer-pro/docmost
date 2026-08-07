import { useCallback, useEffect, useState } from "react";

const TRANSCLUSION_OVERSCAN = "1000px 0px";

export function useTransclusionViewport() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((candidate) => candidate.target === element);
        if (entry) setIsNearViewport(entry.isIntersecting);
      },
      { rootMargin: TRANSCLUSION_OVERSCAN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { viewportRef, isNearViewport };
}
