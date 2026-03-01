import '@/features/editor/styles/index.css';
import classes from '@/pages/database/database-page.module.css';
import { useDebouncedCallback } from '@mantine/hooks';
import { Placeholder } from '@tiptap/extension-placeholder';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorContent, JSONContent, useEditor } from '@tiptap/react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import EmojiCommand from '@/features/editor/extensions/emoji-command.ts';

export interface DatabaseDescriptionPayload {
  json: JSONContent;
  text: string;
}

export interface DatabaseDescriptionEditorProps {
  value: JSONContent;
  editable: boolean;
  onValueChange?: (value: DatabaseDescriptionPayload) => void;
  onAutoSave: (value: DatabaseDescriptionPayload) => Promise<void>;
}

/**
 * Упрощённый rich-text редактор описания базы.
 *
 * Используем движок Tiptap (как в page content), но с компактной схемой,
 * чтобы описание оставалось лёгким и не превращалось в «полноценную страницу».
 */
export function DatabaseDescriptionEditor({
  value,
  editable,
  onValueChange,
  onAutoSave,
}: DatabaseDescriptionEditorProps) {
  const { t } = useTranslation();
  const lastCommittedRef = useRef(JSON.stringify(value ?? {}));

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
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: t('database.editor.addDescription'),
        showOnlyWhenEditable: false,
      }),
      EmojiCommand,
    ],
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

  return (
    <EditorContent
      editor={descriptionEditor}
      className={clsx(classes.databaseDescriptionEditor, {
        [classes.readOnlyDescription]: !editable,
      })}
    />
  );
}
