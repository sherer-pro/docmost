import { Container, Stack, Text, Title } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { useGetDatabaseQuery } from '@/features/database/queries/database-query.ts';
import { DatabaseTableView } from '@/features/database/components/database-table-view';
import { Helmet } from 'react-helmet-async';
import { getAppName } from '@/lib/config.ts';

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
          <Title order={2}>{database?.name || 'Database'}</Title>
          <Text c="dimmed">{database?.description || 'Table view'}</Text>
        </Stack>

        <DatabaseTableView databaseId={databaseId} spaceSlug={spaceSlug} />
      </Container>
    </>
  );
}
