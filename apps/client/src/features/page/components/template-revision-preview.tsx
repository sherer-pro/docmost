import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { mainExtensions } from "@/features/editor/extensions/extensions";

export function TemplateRevisionPreview({
  content,
  label,
}: {
  content: unknown;
  label?: string;
}) {
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
    <div
      role="region"
      aria-label={label}
      style={{
        minHeight: 180,
        padding: "var(--mantine-spacing-md)",
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-md)",
        background: "var(--mantine-color-body)",
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
