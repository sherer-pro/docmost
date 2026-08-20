import React, { lazy, Suspense, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";

const LazyAiDocumentContextSync = lazy(() =>
  import("./ai-document-context-sync").then((module) => ({
    default: module.AiDocumentContextSync,
  })),
);

interface DeferredAiDocumentContextSyncProps {
  pageId: string;
  spaceId: string;
  spaceSlug?: string;
  title: string;
  canWrite: boolean;
}

export function DeferredAiDocumentContextSync(
  props: DeferredAiDocumentContextSyncProps,
) {
  const editor = useAtomValue(pageEditorAtom);
  const editorPageId = (editor?.storage as { pageId?: string } | undefined)
    ?.pageId;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!editor || editorPageId !== props.pageId) {
      setReady(false);
      return;
    }

    const activate = () => setReady(true);
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(activate, { timeout: 1500 });
      return () => cancelIdleCallback(handle);
    }

    const handle = window.setTimeout(activate, 0);
    return () => window.clearTimeout(handle);
  }, [editor, editorPageId, props.pageId]);

  if (!ready) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyAiDocumentContextSync {...props} />
    </Suspense>
  );
}
