import {
  ActionIcon,
  Group,
  Paper,
  ScrollArea,
  Switch,
  Text,
} from "@mantine/core";
import HistoryList from "@/features/page-history/components/history-list";
import classes from "./css/history.module.css";
import { useAtom, useAtomValue } from "jotai";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  diffCountsAtom,
  highlightChangesAtom,
} from "@/features/page-history/atoms/history-atoms";
import HistoryView from "@/features/page-history/components/history-view";
import { HistoryComparisonSelect } from "./history-comparison-select";
import { useRef } from "react";
import { IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useDiffNavigation,
  useHistoryReset,
} from "@/features/page-history/hooks";

interface Props {
  pageId: string;
  readOnly?: boolean;
}

export default function HistoryModalBody({ pageId, readOnly }: Props) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const activeHistoryId = useAtomValue(activeHistoryIdAtom);
  const activeHistoryPrevId = useAtomValue(activeHistoryPrevIdAtom);
  const [highlightChanges, setHighlightChanges] = useAtom(highlightChangesAtom);
  const diffCounts = useAtomValue(diffCountsAtom);

  useHistoryReset(pageId);
  const { currentChangeIndex, handlePrevChange, handleNextChange } =
    useDiffNavigation(scrollViewportRef);

  return (
    <div className={classes.sidebarFlex}>
      <nav className={classes.sidebar}>
        <div className={classes.sidebarMain}>
          <HistoryList pageId={pageId} readOnly={readOnly} />
        </div>
      </nav>

      <div className={classes.historyPreview} data-page-full-width="true">
        <div className={classes.comparisonControls}>
          <HistoryComparisonSelect pageId={pageId} />
        </div>
        <ScrollArea
          className={classes.previewScroll}
          w="100%"
          scrollbarSize={5}
          viewportRef={scrollViewportRef}
        >
          <div className={classes.sidebarRightSection}>
            {activeHistoryId && <HistoryView />}
          </div>
        </ScrollArea>

        {activeHistoryId && activeHistoryPrevId && (
          <Paper
            shadow="md"
            radius="xl"
            px="md"
            py="xs"
            className={classes.diffControls}
          >
            <Group gap="md" justify="center">
              <Switch
                label={t("Highlight changes")}
                checked={highlightChanges}
                onChange={(e) => setHighlightChanges(e.currentTarget.checked)}
                styles={{ label: { userSelect: "none", whiteSpace: "nowrap" } }}
              />
              {highlightChanges && diffCounts && diffCounts.total > 0 && (
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {t("history.changePosition", {
                      current: currentChangeIndex,
                      total: diffCounts.total,
                    })}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    size={32}
                    aria-label={t("history.previousChange")}
                    onClick={handlePrevChange}
                  >
                    <IconChevronUp size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    size={32}
                    aria-label={t("history.nextChange")}
                    onClick={handleNextChange}
                  >
                    <IconChevronDown size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
          </Paper>
        )}
      </div>
    </div>
  );
}
