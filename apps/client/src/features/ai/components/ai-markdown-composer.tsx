import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { useEffect, useRef } from "react";
import {
  composerHtmlToMarkdown,
  isSupportedMarkdownPaste,
  markdownToComposerHtml,
} from "./ai-markdown-composer.utils.ts";
import {
  createAiMarkdownComposerExtensions,
  insertMarkdownPaste,
} from "./ai-markdown-composer.extensions.ts";
import classes from "./ai-panel.module.css";

export function AiMarkdownComposer({
  value,
  onChange,
  onSubmit,
  onEditorChange,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onEditorChange?: (editor: Editor | null) => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const lastValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const editor = useEditor({
    extensions: createAiMarkdownComposerExtensions(placeholder),
    content: markdownToComposerHtml(value),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        role: "textbox",
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!isSupportedMarkdownPaste(text)) {
          return false;
        }

        return insertMarkdownPaste(view, text);
      },
      handleKeyDown: (_view, event) => {
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.isComposing
        ) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      const nextValue = composerHtmlToMarkdown(nextEditor.getHTML());
      lastValueRef.current = nextValue;
      onChangeRef.current(nextValue);
    },
  });

  useEffect(() => {
    if (!editor || value === lastValueRef.current) {
      return;
    }

    const currentValue = composerHtmlToMarkdown(editor.getHTML());
    lastValueRef.current = value;
    if (currentValue !== value) {
      editor.commands.setContent(markdownToComposerHtml(value), {
        emitUpdate: false,
      });
    }
  }, [editor, value]);

  useEffect(() => {
    onEditorChange?.(editor ?? null);
    return () => onEditorChange?.(null);
  }, [editor, onEditorChange]);

  return <EditorContent editor={editor} className={classes.markdownComposer} />;
}
