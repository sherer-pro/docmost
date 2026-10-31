import {
  Alert,
  Anchor,
  Button,
  FileButton,
  Group,
  MultiSelect,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { buildAttachmentFileUrl } from "@docmost/editor-ext";
import { uploadFile } from "@/features/page/services/page-service";
import { getFileUploadSizeLimit } from "@/lib/config";
import api from "@/lib/api-client";

interface FileValue {
  attachmentId: string;
  name?: string;
}
interface PageFiles {
  items: Array<{ id: string; fileName: string; owned: boolean }>;
  meta: { nextCursor?: string };
}

export function DatabaseFileCell({
  value,
  pageId,
  editing,
  label,
  onChange,
  onSave,
  onEdit,
}: {
  value: unknown;
  pageId?: string;
  editing: boolean;
  label: string;
  onChange: (value: unknown) => void;
  onSave: (value?: unknown) => void;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const selected: FileValue[] = Array.isArray(value) ? value : [];
  const result = useInfiniteQuery({
    queryKey: ["database-file-options", pageId, search],
    enabled: editing && Boolean(pageId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<PageFiles>(`/pages/${pageId}/attachments`, {
          params: { query: search, cursor: pageParam, limit: 50 },
        })
      ).data,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const files =
    result.data?.pages.flatMap((page) =>
      page.items.filter((file) => file.owned),
    ) ?? [];
  const options = new Map(
    selected.map((file) => [file.attachmentId, file.name ?? file.attachmentId]),
  );
  for (const file of files) options.set(file.id, file.fileName);
  const save = (ids: string[]) => {
    const next = ids.map((attachmentId) => ({ attachmentId }));
    onChange(next);
    onSave(next);
  };
  if (!editing)
    return (
      <Stack gap={4}>
        {selected.length ? (
          selected.map((file) => (
            <Anchor
              key={file.attachmentId}
              href={buildAttachmentFileUrl(
                file.attachmentId,
                file.name ?? "file",
              )}
              download={file.name}
              style={{ overflowWrap: "anywhere" }}
              onClick={(event) => event.stopPropagation()}
            >
              {file.name ?? file.attachmentId}
            </Anchor>
          ))
        ) : (
          <Text c="dimmed">{t("Empty value")}</Text>
        )}
        {onEdit && (
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            {t("Edit")}
          </Button>
        )}
      </Stack>
    );
  return (
    <Stack gap="xs" onClick={(event) => event.stopPropagation()}>
      <MultiSelect
        label={label}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        clearable
        maxValues={20}
        value={selected.map((file) => file.attachmentId)}
        data={Array.from(options, ([value, label]) => ({ value, label }))}
        disabled={uploading}
        onChange={save}
        nothingFoundMessage={
          result.isFetching ? t("Loading...") : t("No results found")
        }
      />
      {result.hasNextPage && (
        <Button
          size="compact-sm"
          variant="subtle"
          loading={result.isFetchingNextPage}
          onClick={() => void result.fetchNextPage()}
        >
          {t("Load more")}
        </Button>
      )}
      <Group>
        <FileButton
          multiple
          onChange={async (uploads) => {
            if (!pageId || !uploads.length) return;
            setFailed(false);
            if (
              uploads.length + selected.length > 20 ||
              uploads.some((file) => file.size > getFileUploadSizeLimit())
            ) {
              setFailed(true);
              return;
            }
            setUploading(true);
            const ids = selected.map((file) => file.attachmentId);
            try {
              for (const file of uploads)
                ids.push((await uploadFile(file, pageId)).id);
            } catch {
              setFailed(true);
              notifications.show({
                color: "red",
                message: t("dbTable.fileError"),
              });
            } finally {
              if (ids.length > selected.length) {
                save(ids);
                void result.refetch();
              }
              setUploading(false);
            }
          }}
        >
          {(props) => (
            <Button
              {...props}
              size="compact-sm"
              variant="default"
              loading={uploading}
              disabled={!pageId || selected.length >= 20}
            >
              {t("Upload file")}
            </Button>
          )}
        </FileButton>
      </Group>
      {(failed || result.isError) && (
        <Alert color="red">{t("dbTable.fileError")}</Alert>
      )}
      <Text size="xs" c="dimmed">
        {t("dbTable.fileLimit")}
      </Text>
    </Stack>
  );
}
