import type { Editor } from "@tiptap/react";
import { isNodeSelection } from "@tiptap/react";
import {
  isCellSelection,
  isTextSelected,
  TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES,
} from "@docmost/editor-ext";

export function canCreateSyncedBlock(editor: Editor): boolean {
  if (editor.isActive("transclusionSource")) return false;

  const { selection } = editor.state;
  if (isCellSelection(selection)) return false;
  if (isNodeSelection(selection)) {
    if (selection.$from.parent.type.name !== "doc") return false;
    const allowedTypes =
      TRANSCLUSION_SOURCE_ALLOWED_NODE_TYPES as readonly string[];
    if (!allowedTypes.includes(selection.node.type.name)) return false;
  } else {
    if (selection.$from.depth !== 1 || selection.$to.depth !== 1) return false;
    if (!isTextSelected(editor)) return false;
  }

  return editor.can().toggleTransclusionSource();
}
