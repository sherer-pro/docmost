import { Badge, Button, Card, Group, Loader, Stack, Text } from "@mantine/core";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAiSpaceStatusQuery } from "@/features/ai/queries/ai-query.ts";

export function AiSpaceSettingsSummary({
  spaceId,
  spaceSlug,
  onNavigate,
}: {
  spaceId: string;
  spaceSlug: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const status = useAiSpaceStatusQuery(spaceId);

  if (status.isLoading) {
    return (
      <Group justify="center" py="lg" role="status">
        <Loader size="sm" />
      </Group>
    );
  }

  const enabled = status.data?.enabled && status.data?.configured;
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <IconSparkles size={24} color="var(--mantine-color-blue-6)" />
        <Badge color={enabled ? "green" : "gray"} variant="light">
          {enabled
            ? t("ai.integrations.statusReady")
            : t("ai.integrations.statusNeedsSetup")}
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
        to={`/settings/ai/spaces/${spaceSlug}`}
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
