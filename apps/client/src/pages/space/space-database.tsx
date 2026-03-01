import { Card, Container, Group, Text, Title } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useGetDatabaseQuery } from "@/features/database/queries/database-query.ts";
import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import { useTranslation } from "react-i18next";

/**
 * Страница просмотра database в контексте конкретного Space.
 *
 * MVP-реализация не вмешивается в текущий editor flow страниц:
 * row-page открывается стандартным page-маршрутом, а здесь отображаются
 * только метаданные выбранной базы данных.
 */
export default function SpaceDatabase() {
  const { t } = useTranslation();
  const { databaseId } = useParams();
  const { data: database } = useGetDatabaseQuery(databaseId);

  return (
    <>
      <Helmet>
        <title>
          {database?.name || t("Databases")} - {getAppName()}
        </title>
      </Helmet>

      <Container size={"800"} pt="xl">
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={2}>{database?.name || t("Databases")}</Title>
          </Group>

          <Text c="dimmed">
            {database?.description || t("Database section is ready for MVP flow")}
          </Text>
        </Card>
      </Container>
    </>
  );
}
