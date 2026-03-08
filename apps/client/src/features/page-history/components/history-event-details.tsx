import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { IPageHistory } from "@/features/page-history/types/page.types";
import { formatHistoryEventDetails } from "@/features/page-history/utils/history-summary.ts";

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
      <Text size="sm" fw={600}>
        {t("history.event.details.title", { keySeparator: false })}
      </Text>
      {details.map((eventDetail) => (
        <Stack key={eventDetail.id} gap={2}>
          <Text size="sm">{eventDetail.title}</Text>
          {eventDetail.lines.map((line, index) => (
            <Text key={`${eventDetail.id}-${index}`} size="xs" c="dimmed">
              {line}
            </Text>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
