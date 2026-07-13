import { Group, Text, UnstyledButton } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { formattedDate } from "@/lib/time";
import classes from "./css/history.module.css";
import clsx from "clsx";
import { IPageHistory } from "@/features/page-history/types/page.types";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface HistoryItemProps {
  historyItem: IPageHistory;
  index: number;
  onSelect: (id: string, index: number) => void;
  onHover?: (id: string, index: number) => void;
  onHoverEnd?: () => void;
  isActive: boolean;
  canDelete: boolean;
  onDelete: (id: string) => void;
}

const HistoryItem = memo(function HistoryItem({
  historyItem,
  index,
  onSelect,
  onHover,
  onHoverEnd,
  isActive,
  canDelete,
  onDelete,
}: HistoryItemProps) {
  const { t } = useTranslation();

  const handleClick = useCallback(() => {
    onSelect(historyItem.id, index);
  }, [onSelect, historyItem.id, index]);

  const handleMouseEnter = useCallback(() => {
    onHover?.(historyItem.id, index);
  }, [onHover, historyItem.id, index]);

  return (
    <div
      className={clsx(classes.historyRow, { [classes.active]: isActive })}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHoverEnd}
    >
      <UnstyledButton p="xs" onClick={handleClick} className={classes.history}>
        <Text size="sm">{formattedDate(new Date(historyItem.createdAt))}</Text>

        <Group gap={6} wrap="nowrap" mt={4}>
          <CustomAvatar
            size="sm"
            avatarUrl={historyItem.lastUpdatedBy?.avatarUrl}
            name={historyItem.lastUpdatedBy?.name}
          />
          <Text size="sm" c="dimmed" lineClamp={1}>
            {historyItem.lastUpdatedBy?.name}
          </Text>
        </Group>
      </UnstyledButton>

      {canDelete && (
        <AccessibleActionIcon
          label={t("Delete version")}
          color="red"
          variant="subtle"
          onClick={() => onDelete(historyItem.id)}
        >
          <IconTrash size={16} />
        </AccessibleActionIcon>
      )}
    </div>
  );
});

export default HistoryItem;
