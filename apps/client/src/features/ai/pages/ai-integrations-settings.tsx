import {
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
  IconApi,
  IconBrain,
  IconPlugConnected,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import classes from "./ai-integrations-settings.module.css";

export default function AiIntegrationsSettings() {
  const { t } = useTranslation();
  const spacesQuery = useGetSpacesQuery({ limit: 100 });
  const spaces = spacesQuery.data?.items ?? [];

  return (
    <Stack gap="xl" className={classes.page}>
      <Helmet>
        <title>
          {t("ai.integrations.title")} - {getAppName()}
        </title>
      </Helmet>
      <div>
        <SettingsTitle title={t("ai.integrations.title")} />
        <Text c="dimmed" maw={720}>
          {t("ai.integrations.description")}
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <IntegrationCard
          icon={IconPlugConnected}
          title={t("ai.integrations.mcpTitle")}
          description={t("ai.integrations.mcpDescription")}
          href="/settings/ai/mcp"
          badge={t("ai.integrations.workspaceLevel")}
        />
        <IntegrationCard
          icon={IconSearch}
          title={t("ai.integrations.searchTitle")}
          description={t("ai.integrations.searchDescription")}
          href="/settings/ai/search"
          badge={t("ai.integrations.enterprise")}
        />
      </SimpleGrid>

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
          <Badge variant="light">
            {t("ai.integrations.spaceCount", { count: spaces.length })}
          </Badge>
        </Group>

        {spacesQuery.isLoading ? (
          <Group justify="center" py="xl" role="status">
            <Loader size="sm" />
          </Group>
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

      <Card withBorder radius="md" p="md">
        <Group wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" radius="md" size="lg">
            <IconApi size={18} />
          </ThemeIcon>
          <div>
            <Text fw={600}>{t("ai.integrations.ragTitle")}</Text>
            <Text size="sm" c="dimmed">
              {t("ai.integrations.ragDescription")}
            </Text>
          </div>
        </Group>
      </Card>
    </Stack>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
  href,
  badge,
}: {
  icon: typeof IconApi;
  title: string;
  description: string;
  href: string;
  badge: string;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <ThemeIcon variant="light" radius="md" size="xl">
          <Icon size={22} />
        </ThemeIcon>
        <Badge variant="light" color="gray">
          {badge}
        </Badge>
      </Group>
      <Title order={2} size="h4" mt="md">
        {title}
      </Title>
      <Text size="sm" c="dimmed" mt={4} mih={44}>
        {description}
      </Text>
      <Button component={Link} to={href} variant="light" mt="md">
        {t("ai.integrations.open")}
      </Button>
    </Card>
  );
}
