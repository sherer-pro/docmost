import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SlashMenuGroupedItemsType,
  SlashMenuItemType,
} from "@/features/editor/components/slash-menu/types";
import {
  ActionIcon,
  Group,
  Paper,
  ScrollArea,
  Text,
  UnstyledButton,
} from "@mantine/core";
import classes from "./slash-menu.module.css";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

const CommandList = ({
  items,
  command,
  editor,
  range,
}: {
  items: SlashMenuGroupedItemsType;
  command: any;
  editor: any;
  range: any;
}) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeParent, setActiveParent] = useState<SlashMenuItemType | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const resolveChildren = useCallback(
    (item: SlashMenuItemType) => {
      if (!item.children) {
        return [];
      }

      return typeof item.children === "function"
        ? item.children(editor)
        : item.children;
    },
    [editor],
  );

  const visibleGroups = useMemo<SlashMenuGroupedItemsType>(() => {
    if (!activeParent) {
      return items;
    }

    return {
      [activeParent.title]: resolveChildren(activeParent),
    };
  }, [activeParent, items, resolveChildren]);

  /**
   * Transform grouped items into a flat list for consistent keyboard
   * navigation and command execution by index.
   */
  const flatItems = useMemo(() => {
    return Object.values(visibleGroups).flat();
  }, [visibleGroups]);

  /**
   * Map each group-local index to its global index in flatItems so click and
   * keyboard selection stay aligned across groups.
   */
  const groupedItemsWithGlobalIndex = useMemo(() => {
    let globalIndex = 0;

    return Object.entries(visibleGroups).map(([category, categoryItems]) => {
      const categoryItemsWithIndex = categoryItems.map((item) => {
        const normalizedItem = {
          item,
          globalIndex,
        };

        globalIndex += 1;
        return normalizedItem;
      });

      return {
        category,
        categoryItems: categoryItemsWithIndex,
      };
    });
  }, [visibleGroups]);

  const selectItem = useCallback(
    (index: number) => {
      const item = flatItems[index];
      if (item) {
        const children = resolveChildren(item);
        if (children.length > 0) {
          setActiveParent(item);
          setSelectedIndex(0);
          return;
        }

        command(item);
      }
    },
    [command, flatItems, resolveChildren],
  );

  useEffect(() => {
    const navigationKeys = ["ArrowUp", "ArrowDown", "Enter"];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && activeParent) {
        e.preventDefault();
        setActiveParent(null);
        setSelectedIndex(0);
        return true;
      }

      if (navigationKeys.includes(e.key) && flatItems.length > 0) {
        e.preventDefault();

        if (e.key === "ArrowUp") {
          setSelectedIndex(
            (selectedIndex + flatItems.length - 1) % flatItems.length,
          );
          return true;
        }

        if (e.key === "ArrowDown") {
          setSelectedIndex((selectedIndex + 1) % flatItems.length);
          return true;
        }

        if (e.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeParent, flatItems, selectedIndex, setSelectedIndex, selectItem]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [flatItems]);

  useEffect(() => {
    setActiveParent(null);
  }, [items]);

  useEffect(() => {
    viewportRef.current
      ?.querySelector(`[data-item-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return flatItems.length > 0 ? (
    <Paper id="slash-command" shadow="md" p="xs" withBorder>
      <ScrollArea viewportRef={viewportRef} h={350} w={270} scrollbarSize={8}>
        {groupedItemsWithGlobalIndex.map(({ category, categoryItems }) => (
          <div key={category}>
            <Text c="dimmed" mb={4} fw={500} tt="capitalize">
              {category}
            </Text>
            {categoryItems.map(({ item, globalIndex }) => (
              <UnstyledButton
                data-item-index={globalIndex}
                key={`${category}-${globalIndex}`}
                onClick={() => selectItem(globalIndex)}
                className={clsx(classes.menuBtn, {
                  [classes.selectedItem]: globalIndex === selectedIndex,
                })}
              >
                <Group>
                  <ActionIcon variant="default" component="div">
                    <item.icon size={18} />
                  </ActionIcon>

                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>
                      {t(item.title)}
                    </Text>

                    <Text c="dimmed" size="xs">
                      {t(item.description)}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </div>
        ))}
      </ScrollArea>
    </Paper>
  ) : null;
};

export default CommandList;
