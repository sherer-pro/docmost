import { useCallback } from "react";
import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAtom, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import useUserRole from "@/hooks/use-user-role";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  diffCountsAtom,
} from "@/features/page-history/atoms/history-atoms";
import { useDeletePageHistoryMutation } from "@/features/page-history/queries/page-history-query";

export function useHistoryDelete(pageId: string) {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const setActiveHistoryId = useSetAtom(activeHistoryIdAtom);
  const setActiveHistoryPrevId = useSetAtom(activeHistoryPrevIdAtom);
  const [, setDiffCounts] = useAtom(diffCountsAtom);
  const deleteHistoryMutation = useDeletePageHistoryMutation(pageId);

  const handleDelete = useCallback(
    async (historyId: string) => {
      await deleteHistoryMutation.mutateAsync(historyId);
      setActiveHistoryId("");
      setActiveHistoryPrevId("");
      // @ts-ignore
      setDiffCounts(null);
      notifications.show({ message: t("Version deleted successfully") });
    },
    [
      deleteHistoryMutation,
      setActiveHistoryId,
      setActiveHistoryPrevId,
      setDiffCounts,
      t,
    ],
  );

  const confirmDelete = useCallback(
    (historyId: string) => {
      modals.openConfirmModal({
        title: t("Delete version"),
        children: (
          <Text size="sm">
            {t(
              "Are you sure you want to delete this version? This action is irreversible.",
            )}
          </Text>
        ),
        centered: true,
        labels: { confirm: t("Delete"), cancel: t("Cancel") },
        confirmProps: { color: "red" },
        onConfirm: () => handleDelete(historyId),
      });
    },
    [handleDelete, t],
  );

  return {
    canDelete: isAdmin,
    confirmDelete,
    isDeleting: deleteHistoryMutation.isPending,
  };
}
