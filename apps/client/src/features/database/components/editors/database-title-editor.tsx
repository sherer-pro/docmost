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
import EmojiCommand from '@/features/editor/extensions/emoji-command.ts';

export interface DatabaseTitleEditorProps {
  value: string;
  editable: boolean;
  onValueChange?: (value: string) => void;
  onAutoSave: (value: string) => Promise<void>;
}

/**
 * Редактор заголовка базы данных.
 *
 * Адаптер повторяет ключевую UX-логику `TitleEditor`:
 * - H1-структура и placeholder `Untitled`;
 * - debounce-автосохранение;
 * - форс-сохранение при размонтировании;
 * - фокус в конец заголовка после инициализации;
 * - блокировка `mod+s` и поддержка `mod+k`.
 */
export function DatabaseTitleEditor({
  value,
  editable,
  onValueChange,
  onAutoSave,
}: DatabaseTitleEditorProps) {
  const { t } = useTranslation();
  const lastCommittedRef = useRef(value);

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

    if (titleEditor && value !== titleEditor.getText()) {
      titleEditor.commands.setContent(value);
    }
  }, [titleEditor, value]);

  useEffect(() => {
    if (!titleEditor) {
      return;
    }

    titleEditor.setEditable(editable);
  }, [editable, titleEditor]);

  useEffect(() => {
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
