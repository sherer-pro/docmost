import {
  invalidateDatabaseRowContext,
  invalidateSidebarTree,
} from "@/features/page/queries/cache-invalidation";
import { useState } from "react";
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import type { BatchUpdateDatabaseRowOperation } from "@docmost/api-contract";
import { batchUpdateDatabaseRows } from "../services/database-service";
import { getFailedDatabaseOperations } from "../utils/database-editing";
import { queryClient } from "@/lib/query-client";
import { DATABASE_QUERY_KEYS } from "@/features/page/queries/query-keys";

export function useDatabaseBatchOperations(databaseId: string) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const run = async (
    operations: BatchUpdateDatabaseRowOperation[],
  ): Promise<string[]> => {
    setPending(true);
    const failed: BatchUpdateDatabaseRowOperation[] = [];
    try {
      for (let index = 0; index < operations.length; index += 25) {
        const chunk = operations.slice(index, index + 25);
        try {
          const result = await batchUpdateDatabaseRows(databaseId, {
            rows: chunk,
          });
          failed.push(...getFailedDatabaseOperations(chunk, result.failedRows));
        } catch {
          failed.push(...chunk);
        }
      }
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
      await queryClient.invalidateQueries({
        queryKey: DATABASE_QUERY_KEYS.rowsBase(databaseId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["database", databaseId, "summary"],
      });
      if (failed.length)
        notifications.show({
          id: `database-batch-${databaseId}`,
          color: "red",
          autoClose: false,
          message: (
            <Group>
              <Text>
                {t("dbTable.partialFailure", { count: failed.length })}
              </Text>
              <Button size="xs" onClick={() => void run(failed)}>
                {t("Retry")}
              </Button>
            </Group>
          ),
        });
      else notifications.hide(`database-batch-${databaseId}`);
      return failed.map((operation) => operation.pageId);
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}
