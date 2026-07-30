import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import type { AiRunStep } from "@/features/ai/types/ai.types.ts";
import { useTranslation } from "react-i18next";
import classes from "./ai-panel.module.css";

export function AiApprovalPreview({ step }: { step: AiRunStep }) {
  const { t, i18n } = useTranslation();
  const preview = step.approvalPreview;
  if (!preview) {
    return (
      <Text size="xs" c="dimmed">
        {t("ai.agent.previewUnavailable")}
      </Text>
    );
  }

  const expiresAt = step.expiresAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(step.expiresAt))
    : null;

  return (
    <Stack
      gap="xs"
      role="group"
      aria-label={t("ai.agent.previewLabel")}
      className={classes.approvalPreview}
    >
      <Group gap="xs" justify="space-between" wrap="wrap">
        <div>
          <Text size="xs" c="dimmed">
            {t("ai.agent.page")}
          </Text>
          <Text size="sm" fw={600}>
            {preview.pageTitle || t("ai.agent.untitledPage")}
          </Text>
        </div>
        <Badge variant="light" color="orange">
          {t("ai.agent.requiresApproval")}
        </Badge>
      </Group>

      {preview.kind === "insertNode" && preview.anchorText && (
        <Box className={classes.approvalAnchor}>
          <Text size="xs" c="dimmed">
            {preview.position === "before"
              ? t("ai.agent.insertBefore")
              : t("ai.agent.insertAfter")}
          </Text>
          <Text size="xs" lineClamp={2}>
            {preview.anchorText}
          </Text>
        </Box>
      )}

      {preview.beforeText && (
        <Box
          className={classes.approvalBefore}
          aria-label={t("ai.agent.before")}
        >
          <Text size="xs" fw={600}>
            − {t("ai.agent.before")}
          </Text>
          <Text size="xs" className={classes.approvalText}>
            {preview.beforeText}
          </Text>
        </Box>
      )}

      {preview.afterText && (
        <Box
          className={classes.approvalAfter}
          aria-label={t("ai.agent.after")}
        >
          <Text size="xs" fw={600}>
            + {t("ai.agent.after")}
          </Text>
          <Text size="xs" className={classes.approvalText}>
            {preview.afterText}
          </Text>
        </Box>
      )}

      {preview.truncated && (
        <Text size="xs" c="orange.8">
          {t("ai.agent.previewTruncated")}
        </Text>
      )}
      {expiresAt && (
        <Text size="xs" c="dimmed">
          {t("ai.agent.expiresAt", { date: expiresAt })}
        </Text>
      )}
    </Stack>
  );
}
