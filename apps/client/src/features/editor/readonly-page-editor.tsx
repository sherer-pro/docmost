import "@/features/editor/styles/index.css";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorProvider } from "@tiptap/react";
import { mainExtensions } from "@/features/editor/extensions/extensions";
import { Document } from "@tiptap/extension-document";
import { Heading, UniqueID } from "@docmost/editor-ext";
import { Text } from "@tiptap/extension-text";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useAtom } from "jotai";
import { readOnlyEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { useEditorScroll } from "./hooks/use-editor-scroll";
import { TransclusionLookupProvider } from "@/features/editor/components/transclusion/transclusion-lookup-context";
import { PageReadingTime } from "@/features/page/components/reading-time/page-reading-time.tsx";
import editorClasses from "@/features/editor/styles/editor.module.css";

interface PageEditorProps {
  title: string;
  content: any;
  pageId?: string;
  shareId?: string;
  headingNumberingEnabled?: boolean;
  readingTimeEnabled?: boolean;
}

export default function ReadonlyPageEditor({
  title,
  content,
  pageId,
  shareId,
  headingNumberingEnabled = false,
  readingTimeEnabled = false,
}: PageEditorProps) {
  const [readOnlyEditor, setReadOnlyEditor] = useAtom(readOnlyEditorAtom);
  const isComponentMounted = useRef(false);
  const editorCreated = useRef(false);

  const canScroll = useCallback(
    () => isComponentMounted.current && editorCreated.current,
    [isComponentMounted, editorCreated],
  );
  const initialScrollTo = window.location.hash
    ? window.location.hash.slice(1)
    : "";
  const { handleScrollTo } = useEditorScroll({ canScroll, initialScrollTo });

  useEffect(() => {
    isComponentMounted.current = true;
  }, []);

  const extensions = useMemo(() => {
    const filteredExtensions = mainExtensions.filter(
      (ext) => ext.name !== "uniqueID",
    );

    return [
      ...filteredExtensions,
      UniqueID.configure({
        types: ["heading", "paragraph", "transclusionSource"],
        updateDocument: false,
      }),
    ];
  }, []);

  const titleExtensions = [
    Document.extend({
      content: "heading",
    }),
    Heading,
    Text,
    Placeholder.configure({
      placeholder: "Untitled",
      showOnlyWhenEditable: false,
    }),
  ];

  return (
    <TransclusionLookupProvider shareId={shareId}>
      <EditorProvider
        editable={false}
        immediatelyRender={true}
        extensions={titleExtensions}
        content={title}
      ></EditorProvider>

      <PageReadingTime
        editor={readOnlyEditor}
        enabled={readingTimeEnabled}
        pageId={pageId}
        className={editorClasses.readingTime}
      />

      <EditorProvider
        editable={false}
        immediatelyRender={true}
        extensions={extensions}
        content={content}
        onCreate={({ editor }) => {
          if (editor) {
            editor.commands.setHeadingNumberingEnabled(headingNumberingEnabled);
            if (pageId) {
              // @ts-ignore
              editor.storage.pageId = pageId;
            }
            // @ts-ignore
            setReadOnlyEditor(editor);

            handleScrollTo(editor);
            editorCreated.current = true;
          }
        }}
      ></EditorProvider>
      <div style={{ paddingBottom: "20vh" }}></div>
    </TransclusionLookupProvider>
  );
}
