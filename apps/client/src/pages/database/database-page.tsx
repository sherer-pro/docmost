import {
  Button,
  Container,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  useGetDatabaseQuery,
  useUpdateDatabaseMutation,
} from '@/features/database/queries/database-query.ts';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
import { Helmet } from 'react-helmet-async';
import { getAppName } from '@/lib/config.ts';
import { PageEditMode } from '@/features/user/types/user.types.ts';
import { useTranslation } from 'react-i18next';

enum DatabasePageMode {
  View = PageEditMode.Read,
  Edit = PageEditMode.Edit,
}

/**
 * Main database page.
 *
 * Hosts a table view with inline editing, property columns,
 * and basic operations (row/property creation, filtering, sorting).
 */
export default function DatabasePage() {
  const { t } = useTranslation();
  const { databaseId, spaceSlug } = useParams();
  const { data: database } = useGetDatabaseQuery(databaseId);
  const updateDatabaseMutation = useUpdateDatabaseMutation(database?.spaceId, databaseId);

  const [mode, setMode] = useState<DatabasePageMode>(DatabasePageMode.Edit);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const isEditable = mode === DatabasePageMode.Edit;

  useEffect(() => {
    if (!database) {
      return;
    }

    setName(database.name || '');
    setDescription(database.description || '');
  }, [database?.id, database?.name, database?.description]);

  const hasMetaChanges = useMemo(() => {
    if (!database) {
      return false;
    }

    const normalizedName = name.trim();
    const normalizedDescription = description.trim();

    return (
      normalizedName !== (database.name || '').trim() ||
      normalizedDescription !== (database.description || '').trim()
    );
  }, [database, name, description]);

  const handleSaveMeta = async () => {
    if (!database || !databaseId) {
      return;
    }

    await updateDatabaseMutation.mutateAsync({
      name: name.trim() || database.name,
      description: description.trim(),
    });
  };

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

      <Container size="xl" py="xl">
        <Stack gap="xs" mb="lg">
          <Group justify="space-between" align="end">
            <SegmentedControl
              value={mode}
              onChange={(value) => setMode(value as DatabasePageMode)}
              data={[
                { label: t('View'), value: DatabasePageMode.View },
                { label: t('Edit'), value: DatabasePageMode.Edit },
              ]}
            />

            {isEditable && (
              <Button
                onClick={handleSaveMeta}
                loading={updateDatabaseMutation.isPending}
                disabled={!hasMetaChanges || !name.trim()}
              >
                {t('Save')}
              </Button>
            )}
          </Group>

          {isEditable ? (
            <>
              <TextInput
                label={t('Title')}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder={t('Database')}
              />
              <Textarea
                label={t('Description')}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder={t('Table view')}
                autosize
                minRows={2}
              />
            </>
          ) : (
            <>
              <Title order={2}>{database?.name || t('Database')}</Title>
              <Text c="dimmed">{database?.description || t('Table view')}</Text>
            </>
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
