import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { modals } from "@mantine/modals";
import { IconPaperclip } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { buildAttachmentFileUrl } from "@docmost/editor-ext";
import api from "@/lib/api-client";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaLightbox, type PreviewAttachment } from "./media-lightbox";
import classes from "@/components/ui/responsive-table.module.css";

interface GalleryAttachment extends PreviewAttachment {
  fileSize: number;
  usages: string[];
  owned: boolean;
}
interface GalleryPage {
  items: GalleryAttachment[];
  meta: { nextCursor?: string | null };
  canDelete: boolean;
}

export function PageAttachmentsGallery({
  pageId,
  opened,
  onGoToUsage,
  onOverlayOpenChange,
}: {
  pageId: string;
  opened: boolean;
  onGoToUsage: (file: GalleryAttachment) => void;
  onOverlayOpenChange: (opened: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [query] = useDebouncedValue(search, 250);
  const [preview, setPreview] = useState(-1);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const cache = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: ["page-attachments", pageId, query],
    initialPageParam: undefined as string | undefined,
    enabled: opened,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<GalleryPage>(`/pages/${pageId}/attachments`, {
          params: { query, cursor: pageParam, limit: 50 },
        })
      ).data,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.post(`/pages/${pageId}/attachments/${id}/actions/remove`),
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: ["page-attachments", pageId] }),
  });
  const files = result.data?.pages.flatMap((page) => page.items) ?? [];
  const overlayOpen = Boolean(files[preview]) || confirmationOpen;
  useEffect(() => {
    onOverlayOpenChange(overlayOpen);
    return () => onOverlayOpenChange(false);
  }, [overlayOpen, onOverlayOpenChange]);
  const canDelete = result.data?.pages[0]?.canDelete === true;
  const confirmRemove = (file: GalleryAttachment) => {
    setConfirmationOpen(true);
    modals.openConfirmModal({
      title: t("Delete"),
      children: (
        <Text>
          {t("attachmentGallery.deleteConfirm", { name: file.fileName })}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => remove.mutate(file.id),
      onClose: () => setConfirmationOpen(false),
    });
  };
  const size = (bytes: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "unit",
      unit: bytes >= 1048576 ? "megabyte" : bytes >= 1024 ? "kilobyte" : "byte",
      maximumFractionDigits: 1,
    }).format(bytes / (bytes >= 1048576 ? 1048576 : bytes >= 1024 ? 1024 : 1));
  return (
    <Stack>
      <TextInput
        label={t("Search")}
        value={search}
        onChange={(event) => {
          setSearch(event.currentTarget.value);
          setPreview(-1);
        }}
      />
      {result.isPending ? (
        <Loader aria-label={t("Loading...")} />
      ) : result.isError ? (
        <EmptyState
          icon={IconPaperclip}
          title={t("attachmentGallery.loadFailed")}
          action={
            <Button onClick={() => void result.refetch()}>{t("Retry")}</Button>
          }
        />
      ) : !files.length ? (
        <EmptyState icon={IconPaperclip} title={t("No results")} />
      ) : (
        <Table className={classes.responsiveTable} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Name")}</Table.Th>
              <Table.Th>{t("Type")}</Table.Th>
              <Table.Th>{t("Size")}</Table.Th>
              <Table.Th>{t("Actions")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {files.map((file) => (
              <Table.Tr key={file.id}>
                <Table.Td
                  data-label={t("Name")}
                  style={{ overflowWrap: "anywhere" }}
                >
                  <Button
                    variant="subtle"
                    onClick={() => setPreview(files.indexOf(file))}
                    styles={{
                      root: { height: "auto", minHeight: 36, maxWidth: "100%" },
                      label: {
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        textAlign: "start",
                      },
                    }}
                  >
                    {file.fileName}
                  </Button>
                </Table.Td>
                <Table.Td data-label={t("Type")}>
                  <Badge>
                    {file.fileExt?.replace(/^\./, "").toUpperCase() ?? "FILE"}
                  </Badge>
                </Table.Td>
                <Table.Td data-label={t("Size")}>
                  {size(file.fileSize)}
                </Table.Td>
                <Table.Td data-label={t("Actions")}>
                  <Group gap="xs">
                    <Anchor
                      href={buildAttachmentFileUrl(file.id, file.fileName)}
                      download={file.fileName}
                    >
                      {t("Download")}
                    </Anchor>
                    {file.usages.length ? (
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        onClick={() => onGoToUsage(file)}
                      >
                        {t("attachmentGallery.goToUsage")}
                      </Button>
                    ) : (
                      <Text size="xs" c="dimmed">
                        {t("attachmentGallery.unused")}
                      </Text>
                    )}
                    {canDelete && file.owned && (
                      <Button
                        color="red"
                        size="compact-sm"
                        variant="subtle"
                        loading={
                          remove.isPending && remove.variables === file.id
                        }
                        disabled={remove.isPending}
                        onClick={() => confirmRemove(file)}
                      >
                        {t("Delete")}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {remove.isError && (
        <Alert color="red" role="alert">
          {t(
            (remove.error as any)?.response?.data?.code === "attachment_in_use"
              ? "attachmentGallery.inUse"
              : "An error occurred",
          )}
        </Alert>
      )}
      {result.hasNextPage && (
        <Button
          loading={result.isFetchingNextPage}
          onClick={() => void result.fetchNextPage()}
        >
          {t("Load more")}
        </Button>
      )}
      <MediaLightbox
        files={files}
        index={preview}
        onChange={setPreview}
        onClose={() => setPreview(-1)}
      />
    </Stack>
  );
}
