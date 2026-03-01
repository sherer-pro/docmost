import { Container, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
import DatabaseHeader from '@/features/database/components/header/database-header.tsx';
import {
  useGetDatabaseQuery,
  useUpdateDatabaseMutation,
} from '@/features/database/queries/database-query.ts';
import { IUpdateDatabasePayload } from '@/features/database/types/database.types.ts';
import { useGetSpaceBySlugQuery } from '@/features/space/queries/space-query.ts';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '@/features/space/permissions/permissions.type.ts';
import { useSpaceAbility } from '@/features/space/permissions/use-space-ability.ts';
import { PageEditMode } from '@/features/user/types/user.types.ts';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom.ts';
import { getAppName } from '@/lib/config.ts';
import { useAtomValue } from 'jotai';

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

  const commitMetaChanges = async (nextMeta: DatabaseMetaState) => {
    const nextName = nextMeta.name.trim();
    const nextDescription = nextMeta.description.trim();
    const savedName = lastSavedMeta.name.trim();
    const savedDescription = lastSavedMeta.description.trim();

    const patch: IUpdateDatabasePayload = {};

    if (nextName && nextName !== savedName) {
      patch.name = nextName;
    }

    if (nextDescription && nextDescription !== savedDescription) {
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
  };

  const debouncedSave = useDebouncedCallback((nextMeta: DatabaseMetaState) => {
    commitMetaChanges(nextMeta);
  }, 500);

  useEffect(() => {
    if (!isEditable || !database) {
      return;
    }

    if (!hasPendingChanges) {
      return;
    }

    debouncedSave(meta);
  }, [database, debouncedSave, hasPendingChanges, isEditable, meta]);

  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

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
        spaceSlug={spaceSlug}
        spaceName={space?.name}
        databaseName={database?.name}
        readOnly={readOnly}
      />

      <Container size="xl" py="xl" pt={60}>
        <Stack gap="xs" mb="md">
          <TextInput
            label={t('Name')}
            value={meta.name}
            readOnly={!isEditable}
            onChange={(event) => {
              setSaveState('idle');
              setMeta((prev) => ({ ...prev, name: event.currentTarget.value }));
            }}
          />
          <Textarea
            label={t('Description')}
            value={meta.description}
            readOnly={!isEditable}
            autosize
            minRows={2}
            onChange={(event) => {
              setSaveState('idle');
              setMeta((prev) => ({ ...prev, description: event.currentTarget.value }));
            }}
          />
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
