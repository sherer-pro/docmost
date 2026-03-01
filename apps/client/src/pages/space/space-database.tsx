import { Card, Container, Group, Text, Title } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useGetDatabaseQuery } from "@/features/database/queries/database-query.ts";
import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import { useTranslation } from "react-i18next";

/**
 * Database page in the context of a specific space.
 *
 * The MVP implementation does not interfere with the current page editor flow:
 * row pages open via the standard page route, while this screen shows
 * only metadata for the selected database.
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
