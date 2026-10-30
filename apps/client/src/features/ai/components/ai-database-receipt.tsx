import { Alert, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { aiDatabaseReceiptRunsAtom } from "../atoms/ai-atoms";
import { useAiRunQuery } from "../queries/ai-query";

export function AiDatabaseReceipt({
  conversationId,
}: {
  conversationId?: string | null;
}) {
  const { t } = useTranslation();
  const runs = useAtomValue(aiDatabaseReceiptRunsAtom);
  const query = useAiRunQuery(
    conversationId ? runs[conversationId] : undefined,
  );
  if (query.isError) return null;
  const steps =
    query.data?.steps?.filter(
      (step) =>
        step.toolName === "proposeDatabaseCells" &&
        ["approved", "completed", "failed"].includes(step.status),
    ) ?? [];
  return (
    <>
      {steps.map((step) => {
        const result = step.result as {
          updatedRows?: string[];
          failedRows?: Array<{ pageId: string; code: string }>;
        } | null;
        if (!result?.updatedRows && !result?.failedRows) return null;
        const preview =
          step.approvalPreview?.kind === "databaseCells"
            ? step.approvalPreview
            : null;
        return (
          <Alert
            key={step.id}
            title={t("ai.database.receipt")}
            color={result.failedRows?.length ? "orange" : "green"}
          >
            <Stack gap="xs">
              <Text size="sm">
                {t("ai.database.appliedRows", {
                  count: result.updatedRows?.length ?? 0,
                })}
              </Text>
              {result.failedRows?.map((row) => (
                <Text key={row.pageId} size="sm">
                  {preview?.rows.find((item) => item.pageId === row.pageId)
                    ?.title ?? row.pageId}
                  :{" "}
                  {t(`ai.database.failure.${row.code}`, {
                    defaultValue: t("Failed to update data"),
                  })}
                </Text>
              ))}
            </Stack>
          </Alert>
        );
      })}
    </>
  );
}
