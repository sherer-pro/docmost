import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { aiDocumentContextAtom } from "@/features/ai/atoms/ai-atoms.ts";
import { AiDocumentContext } from "@/features/ai/types/ai.types.ts";

export function AiDocumentContextSync({
  pageId,
  spaceId,
  spaceSlug,
  title,
  canWrite,
}: AiDocumentContext) {
  const setContext = useSetAtom(aiDocumentContextAtom);

  useEffect(() => {
    const context = { pageId, spaceId, spaceSlug, title, canWrite };
    setContext(context);

    return () => {
      setContext((current) => (current?.pageId === pageId ? null : current));
    };
  }, [canWrite, pageId, setContext, spaceId, spaceSlug, title]);

  return null;
}
