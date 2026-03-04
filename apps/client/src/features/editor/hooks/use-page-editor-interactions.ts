import { asideStateAtom } from '@/components/layouts/global/hooks/atoms/sidebar-atom';
import { activeCommentIdAtom, showCommentPopupAtom } from '@/features/comment/atoms/comment-atom';
import { handleFileDrop, handlePaste } from '@/features/editor/components/common/editor-paste-handler';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';

interface UsePageEditorInteractionsParams {
  pageId: string;
  editorRef: MutableRefObject<Editor | null>;
  userId?: string;
  supportPlainTextPaste?: boolean;
}

/**
 * Общий слой интеракций редактора, который используется и обычной страницей,
 * и редактором описания базы данных.
 *
 * Что централизуем:
 * - единая реакция на ACTIVE_COMMENT_EVENT;
 * - единое закрытие/сброс comment popup при смене pageId;
 * - одинаковые paste/drop обработчики (включая plain-text paste по Ctrl/Cmd+Shift+V);
 * - одинаковая блокировка стрелок/Enter при открытых slash/emoji меню.
 */
export function usePageEditorInteractions({
  pageId,
  editorRef,
  userId,
  supportPlainTextPaste = false,
}: UsePageEditorInteractionsParams) {
  const plainTextPasteRequestedRef = useRef(false);
  const [, setAsideState] = useAtom(asideStateAtom);
  const [, setActiveCommentId] = useAtom(activeCommentIdAtom);
  const [showCommentPopup, setShowCommentPopup] = useAtom(showCommentPopupAtom);

  const handleActiveCommentEvent = useCallback((event: CustomEvent<{ commentId: string; resolved?: boolean }>) => {
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
    document.addEventListener(
      'ACTIVE_COMMENT_EVENT',
      handleActiveCommentEvent as EventListener,
    );

    return () => {
      document.removeEventListener(
        'ACTIVE_COMMENT_EVENT',
        handleActiveCommentEvent as EventListener,
      );
    };
  }, [handleActiveCommentEvent]);

  useEffect(() => {
    setActiveCommentId(null);
    setShowCommentPopup(false);
  }, [pageId, setActiveCommentId, setShowCommentPopup]);

  const handleKeyDown = useCallback((_view: unknown, event: KeyboardEvent) => {
    if (
      supportPlainTextPaste
      && (event.ctrlKey || event.metaKey)
      && event.shiftKey
      && event.code === 'KeyV'
    ) {
      plainTextPasteRequestedRef.current = true;
    }

    if (['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
      const slashCommand = document.querySelector('#slash-command');
      if (slashCommand) {
        return true;
      }
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) {
      const emojiCommand = document.querySelector('#emoji-command');
      if (emojiCommand) {
        return true;
      }
    }

    return false;
  }, [supportPlainTextPaste]);

  const handleBeforeInput = useCallback((_view: unknown, event: Event) => {
    if (!supportPlainTextPaste) {
      return false;
    }

    const inputEvent = event as InputEvent;
    if (inputEvent.inputType === 'insertFromPasteAsPlainText') {
      plainTextPasteRequestedRef.current = true;
    }

    return false;
  }, [supportPlainTextPaste]);

  const handleEditorPaste = useCallback((_view: unknown, event: ClipboardEvent) => {
    if (!editorRef.current) {
      return false;
    }

    const isPlainTextPasteRequested = plainTextPasteRequestedRef.current;
    plainTextPasteRequestedRef.current = false;

    return handlePaste(editorRef.current, event, pageId, userId, {
      plainTextRequested: isPlainTextPasteRequested,
    });
  }, [editorRef, pageId, userId]);

  const handleEditorDrop = useCallback((_view: unknown, event: DragEvent, _slice: unknown, moved: boolean) => {
    if (!editorRef.current) {
      return false;
    }

    return handleFileDrop(editorRef.current, event, moved, pageId);
  }, [editorRef, pageId]);

  return {
    showCommentPopup,
    handleKeyDown,
    handleBeforeInput,
    handleEditorPaste,
    handleEditorDrop,
  };
}
