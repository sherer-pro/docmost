import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { mainExtensions } from "@/features/editor/extensions/extensions";

export function TemplateRevisionPreview({ content }: { content: unknown }) {
  const editor = useEditor({
    extensions: mainExtensions,
    editable: false,
    immediatelyRender: false,
    content,
  });

  useEffect(() => {
    if (editor && content) editor.commands.setContent(content as never);
  }, [content, editor]);

  return (
    <EditorContent
      editor={editor}
      style={{
        minHeight: 180,
        padding: "var(--mantine-spacing-md)",
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-md)",
        background: "var(--mantine-color-body)",
      }}
    />
  );
}
