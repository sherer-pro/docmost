import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrain,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import classes from "@/features/ai/pages/ai-integrations-settings.module.css";

/**
 * Per-space AI configuration entry points.
 *
 * Extracted verbatim from the former /settings/ai page body when that page
 * became a tab host.
 */
export default function AiSpacesPanel() {
  const { t } = useTranslation();
  const spacesQuery = useGetSpacesQuery({ limit: 100 });
  const spaces = spacesQuery.data?.items ?? [];

  return (
    <section aria-labelledby="ai-spaces-title">
      <Group justify="space-between" align="flex-end" mb="md">
        <div>
          <Title order={2} size="h3" id="ai-spaces-title">
            {t("ai.integrations.spacesTitle")}
          </Title>
          <Text size="sm" c="dimmed">
            {t("ai.integrations.spacesDescription")}
          </Text>
        </div>
        {!spacesQuery.isLoading && !spacesQuery.isError && (
          <Badge variant="light">
            {t("ai.integrations.spaceCount", { count: spaces.length })}
          </Badge>
        )}
      </Group>

      {spacesQuery.isLoading ? (
        <Group justify="center" py="xl" role="status">
          <Loader size="sm" />
        </Group>
      ) : spacesQuery.isError ? (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title={t("Error")}
        >
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{t("ai.loadFailed")}</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={15} />}
              onClick={() => void spacesQuery.refetch()}
            >
              {t("ai.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : spaces.length === 0 ? (
        <EmptyState
          icon={IconBrain}
          title={t("ai.integrations.spacesEmptyTitle")}
          description={t("ai.integrations.spacesDescription")}
          action={
            <Button component={Link} to="/settings/spaces" variant="light">
              {t("Spaces")}
            </Button>
          }
        />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {spaces.map((space) => (
            <Card key={space.id} withBorder radius="md" p="md">
              <Group wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" radius="md" size="lg">
                  <IconBrain size={18} />
                </ThemeIcon>
                <Stack gap={4} flex={1}>
                  <Text fw={600}>{space.name}</Text>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {space.description ||
                      t("ai.integrations.spaceFallbackDescription")}
                  </Text>
                  <Button
                    component={Link}
                    to={`/settings/ai/spaces/${space.slug}`}
                    variant="subtle"
                    size="compact-sm"
                    leftSection={<IconSettings size={15} />}
                    className={classes.cardAction}
                  >
                    {t("ai.integrations.configureSpace")}
                  </Button>
                </Stack>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </section>
  );
}
