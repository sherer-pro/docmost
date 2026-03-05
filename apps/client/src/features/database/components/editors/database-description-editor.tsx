import '@/features/editor/styles/index.css';
import classes from '@/pages/database/database-page.module.css';
import { Editor, EditorContent, JSONContent, useEditor, useEditorState } from '@tiptap/react';
import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { mainExtensions } from '@/features/editor/extensions/extensions';
import { EditorBubbleMenu } from '@/features/editor/components/bubble-menu/bubble-menu';
import TableMenu from '@/features/editor/components/table/table-menu.tsx';
import TableCellMenu from '@/features/editor/components/table/table-cell-menu.tsx';
import LinkMenu from '@/features/editor/components/link/link-menu.tsx';
import ImageMenu from '@/features/editor/components/image/image-menu.tsx';
import VideoMenu from '@/features/editor/components/video/video-menu.tsx';
import CalloutMenu from '@/features/editor/components/callout/callout-menu.tsx';
import SubpagesMenu from '@/features/editor/components/subpages/subpages-menu.tsx';
import ExcalidrawMenu from '@/features/editor/components/excalidraw/excalidraw-menu.tsx';
import DrawioMenu from '@/features/editor/components/drawio/drawio-menu.tsx';
import SearchAndReplaceDialog from '@/features/editor/components/search-and-replace/search-and-replace-dialog.tsx';
import SlashCommand from '@/features/editor/extensions/slash-command';
import CommentDialog from '@/features/comment/components/comment-dialog';
import { getDatabaseDescriptionSlashItems } from './database-description-slash-items';
import { usePageEditorInteractions } from '@/features/editor/hooks/use-page-editor-interactions';
import { serializeDatabaseDescription } from '@/features/database/utils/database-description';

const databaseDescriptionExtensions = mainExtensions.map((extension) => {
  if (extension?.name !== 'slash-command') {
    return extension;
  }

  return SlashCommand.configure({
    suggestion: {
      items: getDatabaseDescriptionSlashItems,
    },
  });
});

export interface DatabaseDescriptionEditorProps {
  pageId: string;
  content: JSONContent;
  editable: boolean;
  onContentChange?: (value: JSONContent) => void;
}

/**
 * A simplified rich-text database description editor.
 *
 * We use the Tiptap engine (as in page content), but with a compact layout,
 * so that the description remains light and does not turn into a “full page”.
 */
export function DatabaseDescriptionEditor({
  pageId,
  content,
  editable,
  onContentChange,
}: DatabaseDescriptionEditorProps) {
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const {
    showCommentPopup,
    handleKeyDown,
    handleEditorPaste,
    handleEditorDrop,
  } = usePageEditorInteractions({
    pageId,
    editorRef,
  });

  const descriptionEditor = useEditor({
    extensions: databaseDescriptionExtensions,
    editorProps: {
      handleDOMEvents: {
        keydown: handleKeyDown,
      },
      handlePaste: handleEditorPaste,
      handleDrop: handleEditorDrop,
    },
    onUpdate({ editor }) {
      onContentChange?.(editor.getJSON());
    },
    editable,
    content,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onCreate({ editor }) {
      // @ts-ignore pageId is dynamically stored in storage during editor initialization.
      editor.storage.pageId = pageId;
      editorRef.current = editor;
    },
  });

  const editorIsEditable = useEditorState({
    editor: descriptionEditor,
    selector: (ctx) => {
      return ctx.editor?.isEditable ?? false;
    },
  });

  useEffect(() => {
    const serializedIncoming = serializeDatabaseDescription(content);

    if (!descriptionEditor) {
      return;
    }

    const serializedEditor = serializeDatabaseDescription(descriptionEditor.getJSON());

    if (serializedIncoming !== serializedEditor) {
      descriptionEditor.commands.setContent(content);
    }
  }, [content, descriptionEditor]);

  useEffect(() => {
    if (!descriptionEditor) {
      return;
    }

    descriptionEditor.setEditable(editable);
  }, [descriptionEditor, editable]);

  return (
    <div ref={menuContainerRef}>
      <EditorContent
        editor={descriptionEditor}
        className={clsx(classes.databaseDescriptionEditor, {
          [classes.readOnlyDescription]: !editable,
        })}
      />

      {descriptionEditor && editorIsEditable && (
        <>
          <SearchAndReplaceDialog editor={descriptionEditor} editable={editable} />
          <EditorBubbleMenu editor={descriptionEditor} />
          <TableMenu editor={descriptionEditor} />
          <TableCellMenu editor={descriptionEditor} appendTo={menuContainerRef} />
          <ImageMenu editor={descriptionEditor} />
          <VideoMenu editor={descriptionEditor} />
          <CalloutMenu editor={descriptionEditor} />
          <SubpagesMenu editor={descriptionEditor} />
          <ExcalidrawMenu editor={descriptionEditor} />
          <DrawioMenu editor={descriptionEditor} />
          <LinkMenu editor={descriptionEditor} appendTo={menuContainerRef} />
        </>
      )}

      {showCommentPopup && descriptionEditor && <CommentDialog editor={descriptionEditor} pageId={pageId} />}
    </div>
  );
}
