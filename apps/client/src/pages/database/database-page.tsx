import { Container, Stack, Text } from '@mantine/core';
import { JSONContent } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
import {
  DatabaseDescriptionEditor,
  DatabaseDescriptionPayload,
} from '@/features/database/components/editors/database-description-editor.tsx';
import { DatabaseTitleEditor } from '@/features/database/components/editors/database-title-editor.tsx';
import DatabaseHeader from '@/features/database/components/header/database-header.tsx';
import HistoryModal from '@/features/page-history/components/history-modal.tsx';
import {
  useGetDatabaseQuery,
  useUpdateDatabaseMutation,
} from '@/features/database/queries/database-query.ts';
import { IUpdateDatabasePayload } from '@/features/database/types/database.types.ts';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '@/features/space/permissions/permissions.type.ts';
import { useSpaceAbility } from '@/features/space/permissions/use-space-ability.ts';
import { useGetSpaceBySlugQuery } from '@/features/space/queries/space-query.ts';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom.ts';
import { PageEditMode } from '@/features/user/types/user.types.ts';
import { getAppName } from '@/lib/config.ts';
import { useAtomValue } from 'jotai';
import classes from './database-page.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const EMPTY_DESCRIPTION_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Преобразует plain-text описание в Tiptap JSON, если rich-контент отсутствует.
 */
function getDescriptionDoc(
  richDescription?: unknown,
  plainDescription?: string | null,
): JSONContent {
  if (richDescription && typeof richDescription === 'object') {
    return richDescription as JSONContent;
  }

  const text = plainDescription?.trim();

  if (!text) {
    return EMPTY_DESCRIPTION_DOC;
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

export default function DatabasePage() {
  const { t } = useTranslation();
  const { databaseId, spaceSlug } = useParams();
  const { data: database } = useGetDatabaseQuery(databaseId);
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const { mutateAsync: updateDatabaseMutationAsync } = useUpdateDatabaseMutation(
    space?.id,
    databaseId,
  );
  const currentUser = useAtomValue(currentUserAtom);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState<DatabaseDescriptionPayload>({
    json: EMPTY_DESCRIPTION_DOC,
    text: '',
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const lastRequestVersionRef = useRef(0);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const readOnly = spaceAbility.cannot(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );

  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;

  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

  useEffect(() => {
    if (!database) {
      return;
    }

    setDraftName(database.name ?? '');
    setDraftDescription({
      json: getDescriptionDoc(database.descriptionContent, database.description),
      text: database.description ?? '',
    });
    setSaveState('idle');
  }, [database?.id, database?.updatedAt]);

  /**
   * Унифицированный автосейв метаданных базы (заголовок/описание).
   */
  const commitMetaChanges = useCallback(
    async (patch: IUpdateDatabasePayload) => {
      if (!databaseId || !space?.id || Object.keys(patch).length === 0) {
        return;
      }

      const requestVersion = lastRequestVersionRef.current + 1;
      lastRequestVersionRef.current = requestVersion;
      setSaveState('saving');

      try {
        const updatedDatabase = await updateDatabaseMutationAsync(patch);

        if (requestVersion !== lastRequestVersionRef.current) {
          return;
        }

        setDraftName(updatedDatabase.name ?? draftName);
        setDraftDescription({
          json: getDescriptionDoc(
            updatedDatabase.descriptionContent,
            updatedDatabase.description,
          ),
          text: updatedDatabase.description ?? '',
        });
        setSaveState('saved');
      } catch {
        if (requestVersion !== lastRequestVersionRef.current) {
          return;
        }

        setSaveState('error');
      }
    },
    [databaseId, draftName, space?.id, updateDatabaseMutationAsync],
  );

  const onTitleAutoSave = useCallback(
    async (nextTitle: string) => {
      const normalizedTitle = nextTitle.trim();
      if (!normalizedTitle || normalizedTitle === (database?.name ?? '').trim()) {
        return;
      }

      await commitMetaChanges({ name: normalizedTitle });
    },
    [commitMetaChanges, database?.name],
  );

  const onDescriptionAutoSave = useCallback(
    async (payload: DatabaseDescriptionPayload) => {
      const currentSerialized = JSON.stringify(
        getDescriptionDoc(database?.descriptionContent, database?.description),
      );
      const nextSerialized = JSON.stringify(payload.json);
      const nextText = payload.text.trim();
      const currentText = (database?.description ?? '').trim();

      if (currentSerialized === nextSerialized && nextText === currentText) {
        return;
      }

      await commitMetaChanges({
        description: payload.text,
        descriptionContent: payload.json,
      });
    },
    [commitMetaChanges, database?.description, database?.descriptionContent],
  );

  const databaseDisplayName = useMemo(() => {
    const normalizedDraft = draftName.trim();
    if (normalizedDraft) {
      return normalizedDraft;
    }

    return database?.name?.trim() || t('database.editor.untitled');
  }, [database?.name, draftName, t]);

  if (!databaseId || !spaceSlug) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {databaseDisplayName} - {getAppName()}
        </title>
      </Helmet>

      <DatabaseHeader
        databaseId={databaseId}
        databasePageId={database?.pageId}
        spaceSlug={spaceSlug}
        spaceName={space?.name}
        databaseName={databaseDisplayName}
        readOnly={readOnly}
      />

      {database?.pageId && <HistoryModal pageId={database.pageId} pageTitle={databaseDisplayName} />}

      <Container size="xl" py="xl" pt={60}>
        <Stack gap="xs" mb="md">
          <div className={classes.titleEditorContainer}>
            <DatabaseTitleEditor
              value={draftName}
              editable={isEditable}
              onValueChange={setDraftName}
              onAutoSave={onTitleAutoSave}
            />
          </div>

          <DatabaseDescriptionEditor
            value={draftDescription.json}
            editable={isEditable}
            onValueChange={setDraftDescription}
            onAutoSave={onDescriptionAutoSave}
          />

          {isEditable && (
            <Text size="sm" c="dimmed">
              {saveState === 'saving' && t('database.editor.saving')}
              {saveState === 'saved' && t('database.editor.saved')}
              {saveState === 'error' && t('database.editor.error')}
            </Text>
          )}
        </Stack>

        {database?.spaceId && (
          <DatabaseTableView
            databaseId={databaseId}
            spaceId={database.spaceId}
            spaceSlug={spaceSlug}
            isEditable={isEditable}
          />
        )}
      </Container>
    </>
  );
}
