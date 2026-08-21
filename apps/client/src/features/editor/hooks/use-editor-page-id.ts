import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";

function getEditorPageId(editor: Editor): string | undefined {
  const pageId = (editor.storage as { pageId?: unknown }).pageId;
  return typeof pageId === "string" && pageId.length > 0 ? pageId : undefined;
}

export function useEditorPageId(editor: Editor): string | undefined {
  const [pageId, setPageId] = useState(() => getEditorPageId(editor));

  useEffect(() => {
    let active = true;
    const syncPageId = () => {
      queueMicrotask(() => {
        if (active) setPageId(getEditorPageId(editor));
      });
    };

    syncPageId();
    editor.on("create", syncPageId);
    return () => {
      active = false;
      editor.off("create", syncPageId);
    };
  }, [editor]);

  return pageId;
}
