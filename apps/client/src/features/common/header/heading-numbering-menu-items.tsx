import { Group, Menu, Switch, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconEraser, IconListNumbers } from "@tabler/icons-react";
import { Editor } from "@tiptap/core";
import { findManualHeadingNumbering } from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { useEditorState } from "@tiptap/react";
import { userAtom } from "@/features/user/atoms/current-user-atom";
import { updateUser } from "@/features/user/services/user-service";
import { normalizeHeadingNumberingByPageId } from "@/features/user/utils/heading-numbering";
import { useState, type ChangeEvent } from "react";

interface HeadingNumberingMenuItemsProps {
  pageId: string;
  checked: boolean;
  editor: Editor | null;
  canWrite: boolean;
}

export function HeadingNumberingMenuItems({
  pageId,
  checked,
  editor,
  canWrite,
}: HeadingNumberingMenuItemsProps) {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const [isPending, setIsPending] = useState(false);
  const hasManualNumbering = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const editorPageId = (
        currentEditor?.storage as { pageId?: string } | undefined
      )?.pageId;
      if (!currentEditor || editorPageId !== pageId) {
        return false;
      }

      return findManualHeadingNumbering(currentEditor.state.doc).length > 0;
    },
  });

  const handleToggle = async (event: ChangeEvent<HTMLInputElement>) => {
    if (isPending) {
      return;
    }

    const enabled = event.currentTarget.checked;
    const currentOverrides = normalizeHeadingNumberingByPageId(
      user?.settings?.preferences?.headingNumberingByPageId,
    );

    setIsPending(true);
    try {
      const updatedUser = await updateUser({
        headingNumberingByPageId: {
          ...currentOverrides,
          [pageId]: enabled,
        },
      });
      setUser(updatedUser);
    } catch {
      notifications.show({
        message: t("Failed to update data"),
        color: "red",
      });
    } finally {
      setIsPending(false);
    }
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
      <Menu.Item leftSection={<IconListNumbers size={16} />}>
        <Group wrap="nowrap" justify="space-between" w="100%">
          <Text>{t("Heading numbering")}</Text>
          <Switch
            checked={checked}
            disabled={isPending}
            onChange={handleToggle}
            aria-label={t("Heading numbering")}
          />
        </Group>
      </Menu.Item>

      {canWrite && hasManualNumbering && (
        <Menu.Item
          leftSection={<IconEraser size={16} />}
          onClick={handleRemoveManualNumbering}
        >
          {t("Remove manual heading numbering")}
        </Menu.Item>
      )}
    </>
  );
}
