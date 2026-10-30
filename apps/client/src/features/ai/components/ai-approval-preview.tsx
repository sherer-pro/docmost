import {
  Badge,
  Box,
  Group,
  Stack,
  Text,
  Table,
  ScrollArea,
} from "@mantine/core";
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
      {preview.kind === "databaseCells" && (
        <ScrollArea type="auto">
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("ai.database.row")}</Table.Th>
                <Table.Th>{t("ai.database.property")}</Table.Th>
                <Table.Th>{t("ai.agent.before")}</Table.Th>
                <Table.Th>{t("ai.agent.after")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {preview.rows.flatMap((row) =>
                row.cells.map((cell) => (
                  <Table.Tr key={`${row.pageId}:${cell.propertyId}`}>
                    <Table.Td>{row.title || row.pageId}</Table.Td>
                    <Table.Td>{cell.propertyName}</Table.Td>
                    <Table.Td
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cell.beforeDisplay ??
                        (typeof cell.before === "string"
                          ? cell.before
                          : JSON.stringify(cell.before))}
                    </Table.Td>
                    <Table.Td
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cell.afterDisplay ??
                        (typeof cell.value === "string"
                          ? cell.value
                          : JSON.stringify(cell.value))}
                    </Table.Td>
                  </Table.Tr>
                )),
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
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
        <Box className={classes.approvalAfter} aria-label={t("ai.agent.after")}>
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
