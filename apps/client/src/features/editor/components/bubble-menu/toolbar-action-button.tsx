import { ActionIcon, Tooltip, rem } from "@mantine/core";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

import type { EditorToolbarItem } from "@/features/editor/components/bubble-menu/toolbar-items";

interface ToolbarActionButtonProps {
  item: EditorToolbarItem;
  activeClassName?: string;
  onBeforeRun?: () => void;
}

export function ToolbarActionButton({
  item,
  activeClassName,
  onBeforeRun,
}: ToolbarActionButtonProps) {
  const { t } = useTranslation();
  const Icon = item.icon;

  return (
    <Tooltip label={t(item.name)} withArrow>
      <ActionIcon
        variant="default"
        size="lg"
        radius="0"
        aria-label={t(item.name)}
        disabled={item.disabled}
        className={clsx(item.isActive && activeClassName)}
        style={{ border: "none" }}
        onClick={() => {
          onBeforeRun?.();
          item.command();
        }}
      >
        <Icon style={{ width: rem(16) }} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );
}
