import { Box, Container, Stack, Text } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
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

type DatabaseMetaState = {
  name: string;
  description: string;
};

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
  const [meta, setMeta] = useState<DatabaseMetaState>({ name: '', description: '' });
  const [lastSavedMeta, setLastSavedMeta] = useState<DatabaseMetaState>({
    name: '',
    description: '',
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const lastRequestVersionRef = useRef(0);
  const latestMetaRef = useRef(meta);
  const latestLastSavedRef = useRef(lastSavedMeta);
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    latestMetaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    latestLastSavedRef.current = lastSavedMeta;
  }, [lastSavedMeta]);

  useEffect(() => {
    if (!database) {
      return;
    }

    const nextMeta = {
      name: database.name ?? '',
      description: database.description ?? '',
    };

    setMeta(nextMeta);
    setLastSavedMeta(nextMeta);
    setSaveState('idle');
  }, [database?.id, database?.updatedAt]);

  const hasPendingChanges = useMemo(
    () =>
      meta.name.trim() !== lastSavedMeta.name.trim() ||
      meta.description.trim() !== lastSavedMeta.description.trim(),
    [lastSavedMeta.description, lastSavedMeta.name, meta.description, meta.name],
  );

  /**
   * Автосохраняет редактируемые метаданные базы.
   *
   * Примечания:
   * - маршрут базы id-based (`/databases/:databaseId`), поэтому slug здесь намеренно не используется;
   * - пустой `name` не отправляется, чтобы не перетирать валидное название пустым значением;
   * - `description` можно полностью очистить (сохраняем пустую строку при изменении).
   */
  const commitMetaChanges = useCallback(
    async (nextMeta: DatabaseMetaState) => {
      const nextName = nextMeta.name.trim();
      const nextDescription = nextMeta.description.trim();
      const savedName = latestLastSavedRef.current.name.trim();
      const savedDescription = latestLastSavedRef.current.description.trim();

      const patch: IUpdateDatabasePayload = {};

      if (nextName && nextName !== savedName) {
        patch.name = nextName;
      }

      if (nextDescription !== savedDescription) {
        patch.description = nextDescription;
      }

      if (Object.keys(patch).length === 0 || !databaseId || !space?.id) {
        setSaveState('idle');
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

        const syncedMeta = {
          name: updatedDatabase.name ?? nextName,
          description: updatedDatabase.description ?? nextDescription,
        };

        setMeta(syncedMeta);
        setLastSavedMeta(syncedMeta);
        setSaveState('saved');
      } catch {
        if (requestVersion !== lastRequestVersionRef.current) {
          return;
        }

        setSaveState('error');
      }
    },
    [databaseId, space?.id, updateDatabaseMutationAsync],
  );

  const debouncedSave = useDebouncedCallback((nextMeta: DatabaseMetaState) => {
    void commitMetaChanges(nextMeta);
  }, 500);

  useEffect(() => {
    if (!isEditable || !database || !hasPendingChanges) {
      return;
    }

    debouncedSave(meta);
  }, [database, debouncedSave, hasPendingChanges, isEditable, meta]);

  useEffect(() => {
    return () => {
      /**
       * При смене маршрута принудительно отправляем последние изменения,
       * чтобы не потерять ввод между debounce-тикaми (паттерн как у `TitleEditor`).
       */
      debouncedSave.cancel();

      if (isEditable) {
        void commitMetaChanges(latestMetaRef.current);
      }
    };
  }, [commitMetaChanges, debouncedSave, isEditable]);

  /**
   * Синхронно пересчитывает высоту textarea по контенту.
   */
  const resizeTextarea = (target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  };

  const onTitleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setSaveState('idle');
    resizeTextarea(event.currentTarget);
    setMeta((prev) => ({ ...prev, name: event.currentTarget.value }));
  };

  const onDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setSaveState('idle');
    resizeTextarea(event.currentTarget);
    setMeta((prev) => ({ ...prev, description: event.currentTarget.value }));
  };

  useEffect(() => {
    if (!isEditable) {
      return;
    }

    if (titleTextareaRef.current) {
      resizeTextarea(titleTextareaRef.current);
    }

    if (descriptionTextareaRef.current) {
      resizeTextarea(descriptionTextareaRef.current);
    }
  }, [isEditable, meta.description, meta.name]);

  if (!databaseId || !spaceSlug) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {database?.name || t('Database')} - {getAppName()}
        </title>
      </Helmet>

      <DatabaseHeader
        databaseId={databaseId}
        databasePageId={database?.pageId}
        spaceSlug={spaceSlug}
        spaceName={space?.name}
        databaseName={database?.name}
        readOnly={readOnly}
      />

      {database?.pageId && <HistoryModal pageId={database.pageId} pageTitle={database?.name} />}

      <Container size="xl" py="xl" pt={60}>
        <Stack gap="xs" mb="md">
          {isEditable ? (
            <Box
              component="textarea"
              className={classes.title}
              data-placeholder={t('Untitled')}
              placeholder={t('Untitled')}
              value={meta.name}
              ref={titleTextareaRef}
              onChange={onTitleChange}
            />
          ) : (
            <Box component="div" className={classes.title} data-placeholder={t('Untitled')}>
              {meta.name || t('Untitled')}
            </Box>
          )}

          {isEditable ? (
            <Box
              component="textarea"
              className={classes.description}
              data-placeholder={t('Add description')}
              placeholder={t('Add description')}
              value={meta.description}
              ref={descriptionTextareaRef}
              onChange={onDescriptionChange}
            />
          ) : (
            <Box component="div" className={classes.description} data-placeholder={t('Add description')}>
              {meta.description}
            </Box>
          )}

          {isEditable && (
            <Text size="sm" c="dimmed">
              {saveState === 'saving' && t('Saving...')}
              {saveState === 'saved' && t('Saved')}
              {saveState === 'error' && t('Could not update')}
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
