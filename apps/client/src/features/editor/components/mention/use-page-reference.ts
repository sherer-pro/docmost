import { useContext, useEffect } from "react";
import type { PageReference } from "@docmost/api-contract";
import { PageReferenceContext } from "./page-reference-context-value";

export function usePageReference(
  pageId: string | null | undefined,
  enabled = true,
): PageReference | undefined {
  const context = useContext(PageReferenceContext);

  useEffect(() => {
    if (enabled && pageId) {
      context?.register(pageId);
    }
  }, [context, enabled, pageId]);

  return pageId ? context?.references.get(pageId) : undefined;
}
