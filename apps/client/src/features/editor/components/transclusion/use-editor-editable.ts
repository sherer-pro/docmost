import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";

export function useEditorEditable(editor: Editor): boolean {
  const [isEditable, setIsEditable] = useState(editor.isEditable);

  useEffect(() => {
    const syncEditable = () => setIsEditable(editor.isEditable);
    syncEditable();
    editor.on("update", syncEditable);
    return () => {
      editor.off("update", syncEditable);
    };
  }, [editor]);

  return isEditable;
}
