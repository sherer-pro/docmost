import {
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import {
  deleteLabel,
  getLabelRegistry,
  ILabelRegistryItem,
  renameLabel,
} from "@/features/label/services/label-service";

interface SpaceLabelsSettingsProps {
  spaceId: string;
}

export default function SpaceLabelsSettings({
  spaceId,
}: SpaceLabelsSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingLabel, setEditingLabel] = useState<ILabelRegistryItem>();
  const [name, setName] = useState("");
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const registry = useInfiniteQuery({
    queryKey: ["label-registry", spaceId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getLabelRegistry({ spaceId, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
  const labels = registry.data?.pages.flatMap((page) => page.items) ?? [];

  const invalidateLabels = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["label-registry", spaceId] }),
      queryClient.invalidateQueries({ queryKey: ["search-labels"] }),
      queryClient.invalidateQueries({ queryKey: ["page-details", "labels"] }),
    ]);
  };

  const stopEditing = () => {
    const labelId = editingLabel?.id;
    setEditingLabel(undefined);
    setName("");
    requestAnimationFrame(() => {
      if (labelId) {
        editButtonRefs.current.get(labelId)?.focus();
      }
    });
  };

  const renameMutation = useMutation({
    mutationFn: renameLabel,
    onSuccess: async () => {
      stopEditing();
      await invalidateLabels();
      notifications.show({ message: t("Updated successfully") });
    },
    onError: () => {
      notifications.show({ message: t("Failed to update data"), color: "red" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLabel,
    onSuccess: async () => {
      await invalidateLabels();
      notifications.show({ message: t("Deleted successfully") });
    },
    onError: () => {
      notifications.show({ message: t("Failed to update data"), color: "red" });
    },
  });

  const startEditing = (label: ILabelRegistryItem) => {
    setEditingLabel(label);
    setName(label.name);
  };

  const submitRename = () => {
    if (!editingLabel || !name.trim()) {
      return;
    }
    renameMutation.mutate({
      labelId: editingLabel.id,
      spaceId,
      name,
    });
  };

  const confirmDelete = (label: ILabelRegistryItem) => {
    modals.openConfirmModal({
      title: t("Delete label {{name}}?", { name: label.name }),
      children: (
        <Text size="sm">
          {t("Deleting a label removes it from every page in this space.")}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteMutation.mutate({ labelId: label.id, spaceId }),
    });
  };

  return (
    <Stack gap="xs">
      <div>
        <Text size="md">{t("Labels")}</Text>
        <Text size="sm" c="dimmed">
          {t("Rename or delete labels used by pages in this space.")}
        </Text>
      </div>

      {registry.isLoading && (
        <Stack gap="xs" aria-label={t("Loading...")}>
          <Skeleton height={54} />
          <Skeleton height={54} />
        </Stack>
      )}

      {!registry.isLoading && labels.length === 0 && (
        <Text size="sm" c="dimmed">
          {t("No labels")}
        </Text>
      )}

      {labels.map((label) => (
        <Paper key={label.id} withBorder p="xs" radius="sm">
          {editingLabel?.id === label.id ? (
            <Group align="flex-end" wrap="nowrap">
              <TextInput
                label={t("Name")}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitRename();
                  } else if (event.key === "Escape") {
                    stopEditing();
                  }
                }}
                maxLength={100}
                autoFocus
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                onClick={submitRename}
                loading={renameMutation.isPending}
                disabled={!name.trim()}
              >
                {t("Save")}
              </Button>
              <Button size="xs" variant="default" onClick={stopEditing}>
                {t("Cancel")}
              </Button>
            </Group>
          ) : (
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {label.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("Pages")}: {label.pageCount}
                </Text>
              </div>
              <Group gap={4} wrap="nowrap">
                <AccessibleActionIcon
                  ref={(element) => {
                    if (element) {
                      editButtonRefs.current.set(label.id, element);
                    }
                  }}
                  variant="subtle"
                  label={`${t("Rename")} ${label.name}`}
                  onClick={() => startEditing(label)}
                >
                  <IconPencil size={16} />
                </AccessibleActionIcon>
                <AccessibleActionIcon
                  color="red"
                  variant="subtle"
                  label={`${t("Delete")} ${label.name}`}
                  onClick={() => confirmDelete(label)}
                  loading={deleteMutation.isPending}
                >
                  <IconTrash size={16} />
                </AccessibleActionIcon>
              </Group>
            </Group>
          )}
        </Paper>
      ))}

      {registry.hasNextPage && (
        <Button
          variant="default"
          onClick={() => registry.fetchNextPage()}
          loading={registry.isFetchingNextPage}
        >
          {t("Load more")}
        </Button>
      )}
    </Stack>
  );
}
