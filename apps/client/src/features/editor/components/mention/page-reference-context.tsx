import type { PageReference } from "@docmost/api-contract";
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePageReferencesQuery } from "@/features/page/queries/page-query";
import { PageReferenceContext } from "./page-reference-context-value";

export function PageReferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const registeredIds = useRef(new Set<string>());
  const scheduled = useRef(false);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const { data = [] } = usePageReferencesQuery(pageIds);

  const register = useCallback((pageId: string) => {
    if (!pageId || registeredIds.current.has(pageId)) {
      return;
    }

    registeredIds.current.add(pageId);
    if (scheduled.current) {
      return;
    }

    scheduled.current = true;
    queueMicrotask(() => {
      scheduled.current = false;
      setPageIds([...registeredIds.current].sort());
    });
  }, []);

  const references = useMemo(
    () => new Map(data.map((reference) => [reference.id, reference])),
    [data],
  );
  const value = useMemo(
    () => ({ references, register }),
    [references, register],
  );

  return (
    <PageReferenceContext.Provider value={value}>
      {children}
    </PageReferenceContext.Provider>
  );
}
