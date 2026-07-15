import { Menu } from "@mantine/core";
import { IconArrowRight, IconCopy } from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

interface PageOperationMenuItemsProps {
  onDuplicate: () => void;
  onMove: () => void;
  onCopyToSpace: () => void;
}

export function PageOperationMenuItems({
  onDuplicate,
  onMove,
  onCopyToSpace,
}: PageOperationMenuItemsProps) {
  const { t } = useTranslation();
  const handleAction =
    (action: () => void) => (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };

  return (
    <>
      <Menu.Item
        leftSection={<IconCopy size={16} />}
        onClick={handleAction(onDuplicate)}
      >
        {t("Duplicate")}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconArrowRight size={16} />}
        onClick={handleAction(onMove)}
      >
        {t("Move")}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconCopy size={16} />}
        onClick={handleAction(onCopyToSpace)}
      >
        {t("Copy to space")}
      </Menu.Item>
    </>
  );
}
