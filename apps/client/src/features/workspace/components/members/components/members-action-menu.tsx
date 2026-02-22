import { Menu, ActionIcon, Text } from "@mantine/core";
import React from "react";
import { IconDots, IconTrash, IconUserOff } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import {
  useDeactivateWorkspaceMemberMutation,
  useDeleteWorkspaceMemberMutation,
} from "@/features/workspace/queries/workspace-query.ts";
import { useTranslation } from "react-i18next";
import useUserRole from "@/hooks/use-user-role.tsx";

interface Props {
  userId: string;
  isDeactivated?: boolean;
}
export default function MemberActionMenu({ userId, isDeactivated = false }: Props) {
  const { t } = useTranslation();
  const deleteWorkspaceMemberMutation = useDeleteWorkspaceMemberMutation();
  const deactivateWorkspaceMemberMutation = useDeactivateWorkspaceMemberMutation();
  const { isAdmin } = useUserRole();

  const onRevoke = async () => {
    await deleteWorkspaceMemberMutation.mutateAsync({ userId });
  };

  const onDeactivate = async () => {
    await deactivateWorkspaceMemberMutation.mutateAsync({ userId });
  };

  const openDeactivateModal = () =>
    modals.openConfirmModal({
      title: t("Deactivate member"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to deactivate this workspace member? They will lose access until reactivated.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Deactivate"), cancel: t("Don't") },
      confirmProps: { color: "orange" },
      onConfirm: onDeactivate,
    });

  const openRevokeModal = () =>
    modals.openConfirmModal({
      title: t("Delete member"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to delete this workspace member? This action is irreversible.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Don't") },
      confirmProps: { color: "red" },
      onConfirm: onRevoke,
    });

  return (
    <>
      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={200}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <ActionIcon variant="subtle" c="gray">
            <IconDots size={20} stroke={2} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            c="orange"
            onClick={openDeactivateModal}
            leftSection={<IconUserOff size={16} />}
            disabled={!isAdmin || isDeactivated}
          >
            {t("Deactivate member")}
          </Menu.Item>
          <Menu.Item
            c="red"
            onClick={openRevokeModal}
            leftSection={<IconTrash size={16} />}
            disabled={!isAdmin}
          >
            {t("Delete member")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
