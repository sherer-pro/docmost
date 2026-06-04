import React, { FC, useCallback, useState } from "react";
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
import type { Editor } from "@tiptap/react";
import { findParentNode, useEditorState } from "@tiptap/react";
import {
  normalizeTableWidthMode,
  type TableWidthMode,
} from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";

interface TableWidthModeSelectorProps {
  editor: Editor;
}

interface WidthModeItem {
  name: string;
  value: TableWidthMode;
  icon: React.ElementType;
}

const WIDTH_MODE_ITEMS: WidthModeItem[] = [
  {
    name: "Normal table width",
    value: "normal",
    icon: IconColumns1,
  },
  {
    name: "Wide table width",
    value: "wide",
    icon: IconColumns2,
  },
  {
    name: "Very wide table width",
    value: "full",
    icon: IconViewportWide,
  },
];

export const TableWidthModeSelector: FC<TableWidthModeSelectorProps> = ({
  editor,
}) => {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const widthMode = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) {
        return "normal";
      }

      const table = findParentNode((node) => node.type.name === "table")(
        ctx.editor.state.selection,
      );

      return normalizeTableWidthMode(table?.node.attrs.widthMode);
    },
  });

  const setWidthMode = useCallback(
    (nextMode: TableWidthMode) => {
      const table = findParentNode((node) => node.type.name === "table")(
        editor.state.selection,
      );

      if (!table) {
        return;
      }

      editor.view.dispatch(
        editor.state.tr
          .setNodeMarkup(table.pos, undefined, {
            ...table.node.attrs,
            widthMode: nextMode,
          })
          .scrollIntoView(),
      );
      editor.commands.focus();
      setOpened(false);
    },
    [editor],
  );

  const activeItem =
    WIDTH_MODE_ITEMS.find((item) => item.value === widthMode) ||
    WIDTH_MODE_ITEMS[0];

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom"
      withArrow
      transitionProps={{ transition: "pop" }}
    >
      <Popover.Target>
        <Tooltip label={t("Table width")} withArrow>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label={t("Table width")}
            onClick={() => setOpened((value) => !value)}
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
                rightSection={item.value === widthMode && <IconCheck size={16} />}
                justify="left"
                fullWidth
                onClick={() => setWidthMode(item.value)}
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
