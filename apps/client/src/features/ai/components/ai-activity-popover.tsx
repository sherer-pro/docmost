import {
  Badge,
  Box,
  Button,
  Group,
  Indicator,
  Loader,
  Popover,
  Stack,
  Text,
} from "@mantine/core";
import { IconCheck, IconSparkles, IconX } from "@tabler/icons-react";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import {
  aiActivityAtom,
  aiUnreadRunsAtom,
} from "@/features/ai/atoms/ai-atoms.ts";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import {
  clearAiPageActivity,
  getVisibleAiActivities,
  isAiActivityActive,
} from "@/features/ai/utils/ai-activity.ts";

export function AiActivityPopover() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activities = useAtomValue(aiActivityAtom);
  const setActivities = useSetAtom(aiActivityAtom);
  const setUnread = useSetAtom(aiUnreadRunsAtom);
  const setAsideState = useSetAtom(asideStateAtom);
  const visible = getVisibleAiActivities(activities);

  if (visible.length === 0) return null;

  const openItem = (runId: string, pageId: string, pageHref?: string) => {
    if (pageHref) navigate(pageHref);
    setAsideState({ tab: "ai", isAsideOpen: true });
    setUnread((current) => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    setActivities((current) => clearAiPageActivity(current, pageId));
  };

  return (
    <Popover position="bottom-end" width={320} shadow="md" withinPortal>
      <Popover.Target>
        <Indicator
          inline
          size={16}
          label={visible.length}
          color={visible.some(isAiActivityActive) ? "blue" : "red"}
          offset={3}
        >
          <AccessibleActionIcon
            variant="subtle"
            label={t("ai.ux.activityTitle")}
            minTargetSize={32}
          >
            <IconSparkles size={18} />
          </AccessibleActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {t("ai.ux.activityTitle")}
          </Text>
          {visible.map((item) => {
            const active = isAiActivityActive(item);
            return (
              <Group key={item.runId} gap="xs" wrap="nowrap">
                <Box w={20}>
                  {active ? (
                    <Loader size={16} />
                  ) : (
                    <IconCheck size={17} color="var(--mantine-color-green-6)" />
                  )}
                </Box>
                <Button
                  variant="subtle"
                  color="gray"
                  justify="flex-start"
                  fullWidth
                  px="xs"
                  disabled={!item.pageHref}
                  onClick={() =>
                    openItem(item.runId, item.pageId, item.pageHref)
                  }
                >
                  <Box ta="start" style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>
                      {item.pageTitle || t("ai.ux.document")}
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={active ? "blue" : "green"}
                    >
                      {active
                        ? t("ai.ux.activityRunning")
                        : t("ai.ux.activityCompleted")}
                    </Badge>
                  </Box>
                </Button>
                {!active && (
                  <AccessibleActionIcon
                    variant="subtle"
                    color="gray"
                    label={t("ai.ux.activityDismiss")}
                    onClick={() =>
                      setActivities((current) => {
                        const next = { ...current };
                        delete next[item.runId];
                        return next;
                      })
                    }
                  >
                    <IconX size={15} />
                  </AccessibleActionIcon>
                )}
              </Group>
            );
          })}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
