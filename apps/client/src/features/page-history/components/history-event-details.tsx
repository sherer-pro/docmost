import { Box, Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { IPageHistory } from "@/features/page-history/types/page.types";
import { formatHistoryEventDetails } from "@/features/page-history/utils/history-summary.ts";
import classes from "@/features/page-history/components/css/history.module.css";

interface HistoryEventDetailsProps {
  historyItem?: IPageHistory;
}

export function HistoryEventDetails({ historyItem }: HistoryEventDetailsProps) {
  const { t } = useTranslation();

  if (!historyItem?.changeType) {
    return null;
  }

  const details = formatHistoryEventDetails(historyItem, t);
  if (details.length === 0) {
    return null;
  }

  return (
    <Stack gap={6} mt={8} mb="md">
      <Text size="md" fw={600}>
        {t("history.event.details.title", { keySeparator: false })}
      </Text>
      {details.map((eventDetail) => (
        <div key={eventDetail.id} className={classes.historyEventCard}>
          <Text size="sm" fw={500} mb={eventDetail.rows.length > 0 ? 6 : 0}>
            {eventDetail.title}
          </Text>

          {eventDetail.rows.length > 0 && (
            <Table
              withTableBorder
              withColumnBorders
              horizontalSpacing="sm"
              verticalSpacing={5}
              className={classes.historyEventTable}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("history.event.details.table.field", { keySeparator: false })}</Table.Th>
                  <Table.Th>{t("history.event.details.table.from", { keySeparator: false })}</Table.Th>
                  <Table.Th>{t("history.event.details.table.to", { keySeparator: false })}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {eventDetail.rows.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td className={classes.historyEventFieldCell}>
                      {row.field}
                    </Table.Td>
                    <Table.Td className={classes.historyEventValueCell}>
                      {row.oldValue}
                    </Table.Td>
                    <Table.Td className={classes.historyEventValueCell}>
                      {row.newValue}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </div>
      ))}
    </Stack>
  );
}
