import React, { FC, useState } from "react";
import {
  IconCheck,
  IconColumns1,
  IconColumns2,
  IconViewportWide,
} from "@tabler/icons-react";
import {
  ActionIcon,
  Button,
  Popover,
  ScrollArea,
  Tooltip,
} from "@mantine/core";
import {
  normalizeBlockWidthMode,
  type BlockWidthMode,
} from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";

interface BlockWidthModeSelectorProps {
  value: BlockWidthMode;
  onChange: (value: BlockWidthMode) => void;
  label: string;
}

interface WidthModeItem {
  name: string;
  value: BlockWidthMode;
  icon: React.ElementType;
}

const WIDTH_MODE_ITEMS: WidthModeItem[] = [
  {
    name: "Normal",
    value: "normal",
    icon: IconColumns1,
  },
  {
    name: "Wide",
    value: "wide",
    icon: IconColumns2,
  },
  {
    name: "Very Wide",
    value: "full",
    icon: IconViewportWide,
  },
];

export const BlockWidthModeSelector: FC<BlockWidthModeSelectorProps> = ({
  value,
  onChange,
  label,
}) => {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const widthMode = normalizeBlockWidthMode(value);
  const activeItem =
    WIDTH_MODE_ITEMS.find((item) => item.value === widthMode) ||
    WIDTH_MODE_ITEMS[0];

  const handleChange = (nextMode: BlockWidthMode) => {
    onChange(nextMode);
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom"
      withArrow
      transitionProps={{ transition: "pop" }}
    >
      <Popover.Target>
        <Tooltip label={label} withArrow>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label={label}
            onClick={() => setOpened((current) => !current)}
          >
            <activeItem.icon size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown>
        <ScrollArea.Autosize type="scroll" mah={300}>
          <Button.Group orientation="vertical">
            {WIDTH_MODE_ITEMS.map((item) => (
              <Button
                key={item.value}
                variant="default"
                leftSection={<item.icon size={16} />}
                rightSection={
                  item.value === widthMode && <IconCheck size={16} />
                }
                justify="left"
                fullWidth
                onClick={() => handleChange(item.value)}
                style={{ border: "none" }}
              >
                {t(item.name)}
              </Button>
            ))}
          </Button.Group>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
};
