import '@/features/editor/styles/index.css';
import classes from '@/pages/database/database-page.module.css';
import { useDebouncedCallback } from '@mantine/hooks';
import { EditorContent, JSONContent, useEditor, useEditorState } from '@tiptap/react';
import React, { useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { mainExtensions } from '@/features/editor/extensions/extensions';
import { EditorBubbleMenu } from '@/features/editor/components/bubble-menu/bubble-menu';
import TableMenu from '@/features/editor/components/table/table-menu.tsx';
import TableCellMenu from '@/features/editor/components/table/table-cell-menu.tsx';
import LinkMenu from '@/features/editor/components/link/link-menu.tsx';
import SlashCommand from '@/features/editor/extensions/slash-command';
import { useAtom } from 'jotai';
import { asideStateAtom } from '@/components/layouts/global/hooks/atoms/sidebar-atom.ts';
import { activeCommentIdAtom, showCommentPopupAtom } from '@/features/comment/atoms/comment-atom';
import CommentDialog from '@/features/comment/components/comment-dialog';
import { getDatabaseDescriptionSlashItems } from './database-description-slash-items';

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

export interface DatabaseDescriptionPayload {
  json: JSONContent;
  text: string;
}

export interface DatabaseDescriptionEditorProps {
  pageId: string;
  value: JSONContent;
  editable: boolean;
  onValueChange?: (value: DatabaseDescriptionPayload) => void;
  onAutoSave: (value: DatabaseDescriptionPayload) => Promise<void>;
}

/**
 * A simplified rich-text database description editor.
 *
 * We use the Tiptap engine (as in page content), but with a compact layout,
 * so that the description remains light and does not turn into a “full page”.
 */
export function DatabaseDescriptionEditor({
  pageId,
  value,
  editable,
  onValueChange,
  onAutoSave,
}: DatabaseDescriptionEditorProps) {
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const lastCommittedRef = useRef(JSON.stringify(value ?? {}));
  const [, setAsideState] = useAtom(asideStateAtom);
  const [, setActiveCommentId] = useAtom(activeCommentIdAtom);
  const [showCommentPopup, setShowCommentPopup] = useAtom(showCommentPopupAtom);

  const saveDescription = useCallback(async () => {
    if (!descriptionEditor) {
      return;
    }

    const json = descriptionEditor.getJSON();
    const serialized = JSON.stringify(json);

    if (serialized === lastCommittedRef.current) {
      return;
    }

    const payload = {
      json,
      text: descriptionEditor.getText().trim(),
    };

    await onAutoSave(payload);
    lastCommittedRef.current = serialized;
  }, [onAutoSave]);

  const debounceUpdate = useDebouncedCallback(() => {
    void saveDescription();
  }, 500);

  const descriptionEditor = useEditor({
    extensions: databaseDescriptionExtensions,
    onUpdate({ editor }) {
      const payload = {
        json: editor.getJSON(),
        text: editor.getText().trim(),
      };

      onValueChange?.(payload);
      debounceUpdate();
    },
    editable,
    content: value,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onCreate({ editor }) {
      // @ts-ignore pageId is dynamically stored in storage during editor initialization.
      editor.storage.pageId = pageId;
    },
  });

  const editorIsEditable = useEditorState({
    editor: descriptionEditor,
    selector: (ctx) => {
      return ctx.editor?.isEditable ?? false;
    },
  });

  useEffect(() => {
    const serialized = JSON.stringify(value ?? {});
    lastCommittedRef.current = serialized;

    if (descriptionEditor && serialized !== JSON.stringify(descriptionEditor.getJSON())) {
      descriptionEditor.commands.setContent(value);
    }
  }, [descriptionEditor, value]);

  useEffect(() => {
    if (!descriptionEditor) {
      return;
    }

    descriptionEditor.setEditable(editable);
  }, [descriptionEditor, editable]);

  useEffect(() => {
    return () => {
      debounceUpdate.cancel();
      void saveDescription();
    };
  }, [debounceUpdate, saveDescription]);

  const handleActiveCommentEvent = useCallback((event) => {
    const { commentId, resolved } = event.detail;

    if (resolved) {
      return;
    }

    setActiveCommentId(commentId);
    setAsideState({ tab: 'comments', isAsideOpen: true });

    setTimeout(() => {
      const selector = `div[data-comment-id="${commentId}"]`;
      const commentElement = document.querySelector(selector);
      commentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
  }, [setActiveCommentId, setAsideState]);

  useEffect(() => {
    document.addEventListener('ACTIVE_COMMENT_EVENT', handleActiveCommentEvent);

    return () => {
      document.removeEventListener('ACTIVE_COMMENT_EVENT', handleActiveCommentEvent);
    };
  }, [handleActiveCommentEvent]);

  useEffect(() => {
    setActiveCommentId(null);
    setShowCommentPopup(false);
  }, [pageId, setActiveCommentId, setShowCommentPopup]);

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
          <EditorBubbleMenu editor={descriptionEditor} />
          <TableMenu editor={descriptionEditor} />
          <TableCellMenu editor={descriptionEditor} appendTo={menuContainerRef} />
          <LinkMenu editor={descriptionEditor} appendTo={menuContainerRef} />
        </>
      )}

      {showCommentPopup && descriptionEditor && <CommentDialog editor={descriptionEditor} pageId={pageId} />}
    </div>
  );
}
