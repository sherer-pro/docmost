import { Button, Group, Select } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
} from "../atoms/history-atoms";
import { usePageHistoryListQuery } from "../queries/page-history-query";
import { formattedDate } from "@/lib/time";

export function HistoryComparisonSelect({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const current = useAtomValue(activeHistoryIdAtom);
  const [previous, setPrevious] = useAtom(activeHistoryPrevIdAtom);
  const query = usePageHistoryListQuery(pageId);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Group p="xs" align="flex-end">
      <Select
        label={t("documentUpdates.compareWith")}
        value={previous || null}
        searchable
        data={items
          .filter((item) => item.id !== current)
          .map((item) => ({
            value: item.id,
            label: `${formattedDate(new Date(item.createdAt))} · ${item.lastUpdatedBy?.name ?? ""}`,
          }))}
        onChange={(id) => setPrevious(id ?? "")}
        clearable
        style={{ flex: 1 }}
      />
      {query.hasNextPage && (
        <Button
          variant="subtle"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("Load more")}
        </Button>
      )}
    </Group>
  );
}
