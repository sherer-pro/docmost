import '@/features/editor/styles/index.css';
import React, { useCallback, useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Document } from '@tiptap/extension-document';
import { Heading } from '@tiptap/extension-heading';
import { Text } from '@tiptap/extension-text';
import { Placeholder } from '@tiptap/extension-placeholder';
import { History } from '@tiptap/extension-history';
import { useDebouncedCallback } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { searchSpotlight } from '@/features/search/constants.ts';
import { shouldApplyFocusSafeTitleSync } from '@/features/editor/utils/title-editor-sync.ts';
import EmojiCommand from '@/features/editor/extensions/emoji-command.ts';

export interface DatabaseTitleEditorProps {
  databaseId: string;
  value: string;
  editable: boolean;
  onValueChange?: (value: string) => void;
  onAutoSave: (value: string) => Promise<void>;
  onFocusChange?: (isFocused: boolean) => void;
}

/**
 * Database header editor.
 *
 * The adapter repeats the key UX logic of `TitleEditor`:
 * - H1-structure and placeholder `Untitled`;
 * - debounce autosave;
 * - force saving when unmounting;
 * - focus to the end of the header after initialization;
 * - `mod+s` blocking and `mod+k` support.
 */
export function DatabaseTitleEditor({
  databaseId,
  value,
  editable,
  onValueChange,
  onAutoSave,
  onFocusChange,
}: DatabaseTitleEditorProps) {
  const { t } = useTranslation();
  const lastCommittedRef = useRef(value);
  const didInitFocusRef = useRef(false);
  const lastSyncedDatabaseIdRef = useRef(databaseId);

  const saveTitle = useCallback(async () => {
    if (!titleEditor) {
      return;
    }

    const nextTitle = titleEditor.getText().trim();

    if (nextTitle === lastCommittedRef.current.trim()) {
      return;
    }

    await onAutoSave(nextTitle);
    lastCommittedRef.current = nextTitle;
  }, [onAutoSave]);

  const debounceUpdate = useDebouncedCallback(() => {
    void saveTitle();
  }, 500);

  const titleEditor = useEditor({
    extensions: [
      Document.extend({
        content: 'heading',
      }),
      Heading.configure({
        levels: [1],
      }),
      Text,
      Placeholder.configure({
        placeholder: t('database.editor.untitled'),
        showOnlyWhenEditable: false,
      }),
      History.configure({
        depth: 20,
      }),
      EmojiCommand,
    ],
    onUpdate({ editor }) {
      const nextTitle = editor.getText();
      onValueChange?.(nextTitle);
      debounceUpdate();
    },
    editable,
    content: value,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      handleDOMEvents: {
        focus: () => {
          onFocusChange?.(true);
          return false;
        },
        blur: () => {
          onFocusChange?.(false);
          return false;
        },
        keydown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
            event.preventDefault();
            return true;
          }

          if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
            searchSpotlight.open();
            return true;
          }

          return false;
        },
      },
    },
  });

  useEffect(() => {
    lastCommittedRef.current = value;

    if (!titleEditor) {
      return;
    }

    const nextTitle = value ?? '';
    const currentTitle = titleEditor.getText();
    const { from, to } = titleEditor.state.selection;

    const shouldApplySync = shouldApplyFocusSafeTitleSync({
      entityId: databaseId,
      lastSyncedEntityId: lastSyncedDatabaseIdRef.current,
      nextTitle,
      currentTitle,
      isFocused: titleEditor.isFocused,
      hasCollapsedSelection: from === to,
    });

    if (!shouldApplySync) {
      if (nextTitle === currentTitle) {
        lastSyncedDatabaseIdRef.current = databaseId;
      }
      return;
    }

    titleEditor.commands.setContent(nextTitle);
    lastSyncedDatabaseIdRef.current = databaseId;
  }, [databaseId, titleEditor, value]);

  useEffect(() => {
    if (!titleEditor) {
      return;
    }

    titleEditor.setEditable(editable);
  }, [editable, titleEditor]);

  useEffect(() => {
    if (!titleEditor || didInitFocusRef.current) {
      return;
    }

    didInitFocusRef.current = true;

    const focusTimer = setTimeout(() => {
      if (!titleEditor?.isInitialized || !editable) {
        return;
      }

      titleEditor.commands.focus('end');
    }, 300);

    return () => {
      clearTimeout(focusTimer);
    };
  }, [editable, titleEditor]);

  useEffect(() => {
    return () => {
      debounceUpdate.cancel();
      void saveTitle();
    };
  }, [debounceUpdate, saveTitle]);

  return <EditorContent editor={titleEditor} />;
}
