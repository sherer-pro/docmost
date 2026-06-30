import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  IconBold,
  IconCode,
  IconItalic,
  IconStrikethrough,
  IconUnderline,
} from "@tabler/icons-react";

export interface EditorToolbarItem {
  name: string;
  isActive?: boolean;
  disabled?: boolean;
  command: () => void;
  icon: typeof IconBold;
}

export function useInlineTextToolbarItems(
  editor: Editor | null,
): EditorToolbarItem[] {
  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) {
        return null;
      }

      return {
        isBold: ctx.editor.isActive("bold"),
        isItalic: ctx.editor.isActive("italic"),
        isUnderline: ctx.editor.isActive("underline"),
        isStrike: ctx.editor.isActive("strike"),
        isCode: ctx.editor.isActive("code"),
      };
    },
  });

  return [
    {
      name: "Bold",
      isActive: Boolean(editorState?.isBold),
      command: () => editor?.chain().focus().toggleBold().run(),
      icon: IconBold,
    },
    {
      name: "Italic",
      isActive: Boolean(editorState?.isItalic),
      command: () => editor?.chain().focus().toggleItalic().run(),
      icon: IconItalic,
    },
    {
      name: "Underline",
      isActive: Boolean(editorState?.isUnderline),
      command: () => editor?.chain().focus().toggleUnderline().run(),
      icon: IconUnderline,
    },
    {
      name: "Strike",
      isActive: Boolean(editorState?.isStrike),
      command: () => editor?.chain().focus().toggleStrike().run(),
      icon: IconStrikethrough,
    },
    {
      name: "Code",
      isActive: Boolean(editorState?.isCode),
      command: () => editor?.chain().focus().toggleCode().run(),
      icon: IconCode,
    },
  ];
}
