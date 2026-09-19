import { Badge, Button, Card, Group, Loader, Stack, Text } from "@mantine/core";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAiSpaceStatusQuery } from "@/features/ai/queries/ai-query.ts";

export function AiSpaceSettingsSummary({
  spaceId,
  spaceSlug,
  onNavigate,
  fromSpaceSettings,
}: {
  spaceId: string;
  spaceSlug: string;
  onNavigate?: () => void;
  fromSpaceSettings?: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const status = useAiSpaceStatusQuery(spaceId);

  if (status.isLoading) {
    return (
      <Group justify="center" py="lg" role="status">
        <Loader size="sm" />
      </Group>
    );
  }

  if (status.isError)
    return (
      <Stack>
        <Text role="alert">{t("ai.loadFailed")}</Text>
        <Button onClick={() => void status.refetch()}>{t("Retry")}</Button>
      </Stack>
    );
  const enabled = status.data?.enabled && status.data?.configured;
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <IconSparkles size={24} color="var(--mantine-color-blue-6)" />
        <Badge
          color={enabled ? "green" : "gray"}
          variant="light"
          c="var(--mantine-color-text)"
        >
          {enabled
            ? t("spaceAdmin.aiEnabled")
            : status.data?.configured
              ? t("spaceAdmin.aiDisabled")
              : t("spaceAdmin.aiNotConfigured")}
        </Badge>
      </Group>
      <Stack gap={4} mt="md">
        <Text fw={600}>{t("ai.integrations.spaceCardTitle")}</Text>
        <Text size="sm" c="dimmed">
          {t("ai.integrations.spaceCardDescription")}
        </Text>
      </Stack>
      <Button
        component={Link}
        to={`/settings/ai/spaces/${spaceSlug}${fromSpaceSettings ? "?from=space-settings" : ""}`}
        state={location.state}
        fullWidth
        mt="md"
        rightSection={<IconArrowRight size={16} />}
        onClick={onNavigate}
      >
        {t("ai.integrations.openFullSettings")}
      </Button>
    </Card>
  );
}
