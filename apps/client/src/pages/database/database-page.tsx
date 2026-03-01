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

enum DatabasePageMode {
  View = PageEditMode.Read,
  Edit = PageEditMode.Edit,
}

/**
 * Основная страница database.
 *
 * Здесь размещено табличное представление с inline-редактированием,
 * колонками свойств и базовыми операциями (добавление row/property,
 * фильтрация и сортировка).
 */
export default function DatabasePage() {
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
          {database?.name || 'Database'} - {getAppName()}
        </title>
      </Helmet>

      <Container size="xl" py="xl">
        <Stack gap="xs" mb="lg">
          <Group justify="space-between" align="end">
            <SegmentedControl
              value={mode}
              onChange={(value) => setMode(value as DatabasePageMode)}
              data={[
                { label: 'View', value: DatabasePageMode.View },
                { label: 'Edit', value: DatabasePageMode.Edit },
              ]}
            />

            {isEditable && (
              <Button
                onClick={handleSaveMeta}
                loading={updateDatabaseMutation.isPending}
                disabled={!hasMetaChanges || !name.trim()}
              >
                Save
              </Button>
            )}
          </Group>

          {isEditable ? (
            <>
              <TextInput
                label="Title"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Database"
              />
              <Textarea
                label="Description"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="Table view"
                autosize
                minRows={2}
              />
            </>
          ) : (
            <>
              <Title order={2}>{database?.name || 'Database'}</Title>
              <Text c="dimmed">{database?.description || 'Table view'}</Text>
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
