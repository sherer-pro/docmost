import { Menu, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconEraser, IconListNumbers } from "@tabler/icons-react";
import { Editor } from "@tiptap/core";
import { findManualHeadingNumbering } from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";
import { PageSettings } from "@/features/page/types/page.types";
import { ISpaceSettings } from "@/features/space/types/space.types";
import { useUpdatePageMutation } from "@/features/page/queries/page-query";
import {
  getHeadingNumberingOverride,
  HeadingNumberingOverride,
} from "@/features/page/utils/heading-numbering";
import { useQueryEmit } from "@/features/websocket/use-query-emit";

interface HeadingNumberingMenuItemsProps {
  pageId: string;
  spaceId: string;
  pageSettings?: PageSettings;
  spaceSettings?: ISpaceSettings;
  editor: Editor | null;
  canWrite: boolean;
}

const overrideValues: Array<{
  value: HeadingNumberingOverride;
  label: "Use space setting" | "Enabled" | "Disabled";
}> = [
  { value: "inherit", label: "Use space setting" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

export function HeadingNumberingMenuItems({
  pageId,
  spaceId,
  pageSettings,
  spaceSettings,
  editor,
  canWrite,
}: HeadingNumberingMenuItemsProps) {
  const { t } = useTranslation();
  const { mutateAsync: updatePage, isPending } = useUpdatePageMutation();
  const emit = useQueryEmit();
  const currentOverride = getHeadingNumberingOverride(pageSettings);

  if (!canWrite) {
    return null;
  }

  const handleOverrideChange = async (value: HeadingNumberingOverride) => {
    if (value === currentOverride || isPending) {
      return;
    }

    const headingNumberingEnabled =
      value === "inherit" ? null : value === "enabled";
    const updatedPage = await updatePage({
      pageId,
      headingNumberingEnabled,
    });

    emit({
      operation: "updateOne",
      entity: ["pages"],
      id: pageId,
      spaceId,
      payload: { settings: updatedPage.settings },
    });
  };

  const handleRemoveManualNumbering = () => {
    if (!editor) {
      return;
    }

    const matches = findManualHeadingNumbering(editor.state.doc);
    if (matches.length === 0) {
      notifications.show({
        message: t("No manual heading numbering found"),
      });
      return;
    }

    modals.openConfirmModal({
      title: t("Remove manual heading numbering?"),
      centered: true,
      children: (
        <Text size="sm">
          {t("Remove numbering from {{count}} headings?", {
            count: matches.length,
          })}
        </Text>
      ),
      labels: {
        confirm: t("Remove numbering"),
        cancel: t("Cancel"),
      },
      onConfirm: () => {
        if (editor.commands.removeManualHeadingNumbering()) {
          notifications.show({
            message: t("Manual heading numbering removed"),
          });
        }
      },
    });
  };

  return (
    <>
      <Menu.Sub>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<IconListNumbers size={16} />}>
            {t("Heading numbering")}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>
          {overrideValues.map((option) => (
            <Menu.Item
              key={option.value}
              onClick={() => handleOverrideChange(option.value)}
              disabled={isPending}
              rightSection={
                currentOverride === option.value ? (
                  <IconCheck size={16} />
                ) : null
              }
            >
              {option.value === "inherit"
                ? `${t(option.label)} (${t(
                    spaceSettings?.headingNumbering?.enabled
                      ? "Enabled"
                      : "Disabled",
                  )})`
                : t(option.label)}
            </Menu.Item>
          ))}
        </Menu.Sub.Dropdown>
      </Menu.Sub>

      <Menu.Item
        leftSection={<IconEraser size={16} />}
        onClick={handleRemoveManualNumbering}
        disabled={!editor}
      >
        {t("Remove manual heading numbering")}
      </Menu.Item>
    </>
  );
}
