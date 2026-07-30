import type { Editor } from "@tiptap/core";

export function lockEditorInteraction(editor: Editor): () => void {
  const editorElement = editor.view.dom;
  const wasInert = editorElement.hasAttribute("inert");

  if (!wasInert) {
    editorElement.setAttribute("inert", "");
  }

  return () => {
    if (!wasInert) {
      editorElement.removeAttribute("inert");
    }
  };
}
