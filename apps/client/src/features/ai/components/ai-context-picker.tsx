import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Group,
  Loader,
  Menu,
  Modal,
  Pill,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconDatabase,
  IconFileText,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconTableRow,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useAiContextSourcesQuery } from "@/features/ai/queries/ai-query.ts";
import {
  AiChatFile,
  AiContextSource,
  AiPageAttachment,
} from "@/features/ai/types/ai.types.ts";
import classes from "./ai-panel.module.css";
import { dedupeAiContextSources } from "@/features/ai/utils/ai-context.ts";

interface AiContextPickerProps {
  conversationId?: string;
  spaceId: string;
  documentTitle: string;
  includeCurrentDocument: boolean;
  sources: AiContextSource[];
  fileIds: string[];
  attachmentIds: string[];
  chatFiles: AiChatFile[];
  pageAttachments: AiPageAttachment[];
  loadingFiles: boolean;
  saving: boolean;
  saveFailed: boolean;
  onToggleCurrentDocument: (included: boolean) => Promise<unknown>;
  onAddSource: (source: AiContextSource) => Promise<unknown>;
  onRemoveSource: (source: AiContextSource) => Promise<unknown>;
  onToggleFile: (fileId: string, included: boolean) => Promise<unknown>;
  onToggleAttachment: (
    attachmentId: string,
    included: boolean,
  ) => Promise<unknown>;
  onUpload: (files: File[]) => Promise<void>;
  onDeleteFile: (fileId: string, fileName: string) => void;
  onRetrySave: () => Promise<void>;
}

export function AiContextPicker(props: AiContextPickerProps) {
  const { t } = useTranslation();
  const [searchOpened, setSearchOpened] = useState(false);
  const [query, setQuery] = useState("");
  const isCoarsePointer = useMediaQuery("(pointer: coarse)");
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const search = useAiContextSourcesQuery(props.conversationId, debouncedQuery);
  const searchItems = useMemo(
    () =>
      dedupeAiContextSources(
        search.data?.pages.flatMap((page) => page.items) ?? [],
      ),
    [search.data?.pages],
  );
  const selectedIdentities = useMemo(
    () =>
      new Set(
        props.sources.map(
          (source) => `${source.sourceType}:${source.sourceId}`,
        ),
      ),
    [props.sources],
  );
  const selectedCount =
    props.sources.length + props.fileIds.length + props.attachmentIds.length;

  return (
    <>
      <div>
        <Menu
          position="top-end"
          width="min(360px, calc(100vw - 24px))"
          withinPortal
        >
          <Menu.Target>
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconPaperclip size={16} />}
              rightSection={
                <Badge size="xs" variant="light">
                  {props.sources.length}/10
                </Badge>
              }
              disabled={props.saving}
              className={classes.toolbarButton}
              aria-label={`${t("ai.context.title")}: ${selectedCount}`}
            >
              <span className={classes.toolbarButtonLabel}>
                {t("ai.context.title")}
              </span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className={classes.contextMenu}>
            <Menu.Label>{t("ai.context.documents")}</Menu.Label>
            <Menu.Item closeMenuOnClick={false}>
              <Checkbox
                size="xs"
                checked={props.includeCurrentDocument}
                label={props.documentTitle || t("ai.untitled")}
                className={classes.contextFileCheckbox}
                onChange={(event) =>
                  void props.onToggleCurrentDocument(
                    event.currentTarget.checked,
                  ).catch(() => undefined)
                }
              />
            </Menu.Item>
            {props.sources.length > 0 && (
              <Pill.Group px="xs" pb={4} className={classes.contextSourceGroup}>
                {props.sources.map((source) => (
                  <Pill
                    key={`${source.sourceType}:${source.sourceId}`}
                    withRemoveButton
                    className={classes.contextSourcePill}
                    onRemove={() =>
                      void props.onRemoveSource(source).catch(() => undefined)
                    }
                    removeButtonProps={{
                      "aria-label": t("ai.context.removeSource"),
                    }}
                    title={source.title || t("ai.untitled")}
                  >
                    {source.title || t("ai.untitled")}
                  </Pill>
                ))}
              </Pill.Group>
            )}
            <Menu.Item
              leftSection={<IconPlus size={15} />}
              onClick={() => setSearchOpened(true)}
            >
              {t("ai.context.addFromSpace")}
            </Menu.Item>

            <Divider my="xs" />
            <FileButton
              onChange={(files) => void props.onUpload(files)}
              accept=".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp"
              multiple
            >
              {(fileButtonProps) => (
                <Menu.Item
                  {...fileButtonProps}
                  leftSection={<IconUpload size={15} />}
                >
                  {t("ai.context.uploadPrivateFiles")}
                </Menu.Item>
              )}
            </FileButton>
            {props.loadingFiles && (
              <Group justify="center" py="xs">
                <Loader size="xs" />
              </Group>
            )}
            {props.chatFiles.map((file) => (
              <Menu.Item key={file.id} closeMenuOnClick={false}>
                <Group gap={4} wrap="nowrap" className={classes.contextFileRow}>
                  <Checkbox
                    size="xs"
                    checked={props.fileIds.includes(file.id)}
                    disabled={file.status !== "ready"}
                    label={file.name}
                    className={classes.contextFileCheckbox}
                    onChange={(event) =>
                      void props.onToggleFile(
                        file.id,
                        event.currentTarget.checked,
                      ).catch(() => undefined)
                    }
                  />
                  {file.status !== "ready" && (
                    <Badge
                      variant="light"
                      color={file.status === "failed" ? "red" : "blue"}
                      size="xs"
                    >
                      {t(`ai.fileStatus.${file.status}`)}
                    </Badge>
                  )}
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size={32}
                    aria-label={`${t("ai.deleteFile")}: ${file.name}`}
                    onClick={() => props.onDeleteFile(file.id, file.name)}
                  >
                    <IconTrash size={13} />
                  </ActionIcon>
                </Group>
              </Menu.Item>
            ))}
            {props.pageAttachments.length > 0 && (
              <>
                <Menu.Label>{t("ai.pageAttachments")}</Menu.Label>
                {props.pageAttachments.map((attachment) => (
                  <Menu.Item key={attachment.id} closeMenuOnClick={false}>
                    <Checkbox
                      size="xs"
                      checked={props.attachmentIds.includes(attachment.id)}
                      label={attachment.fileName}
                      className={classes.contextFileCheckbox}
                      onChange={(event) =>
                        void props.onToggleAttachment(
                          attachment.id,
                          event.currentTarget.checked,
                        ).catch(() => undefined)
                      }
                    />
                  </Menu.Item>
                ))}
              </>
            )}
            {props.saveFailed && (
              <Alert color="red" variant="light" p="xs">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs">{t("ai.ux.contextSaveFailed")}</Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => void props.onRetrySave()}
                  >
                    {t("ai.tryAgain")}
                  </Button>
                </Group>
              </Alert>
            )}
            {!isCoarsePointer && (
              <Menu.Label>{t("ai.context.dragHint")}</Menu.Label>
            )}
          </Menu.Dropdown>
        </Menu>
      </div>

      <Modal
        opened={searchOpened}
        onClose={() => setSearchOpened(false)}
        title={t("ai.context.searchTitle")}
        closeButtonProps={{ "aria-label": t("Close") }}
        centered
        size="md"
        classNames={{
          content: classes.contextSearchModalContent,
          body: classes.contextSearchModalBody,
        }}
      >
        <Stack gap="sm" className={classes.contextSearchLayout}>
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("ai.context.searchPlaceholder")}
            leftSection={<IconSearch size={16} />}
            autoFocus
          />
          <Box className={classes.contextSearchResultsRegion}>
            {search.isLoading ? (
              <Group justify="center" className={classes.contextSearchState}>
                <Loader size="sm" />
              </Group>
            ) : search.isError ? (
              <Text
                c="red"
                size="sm"
                ta="center"
                className={classes.contextSearchState}
              >
                {t("ai.context.searchFailed")}
              </Text>
            ) : query.trim() && searchItems.length === 0 ? (
              <Text
                c="dimmed"
                size="sm"
                ta="center"
                className={classes.contextSearchState}
              >
                {t("ai.context.noResults")}
              </Text>
            ) : (
              <ScrollArea
                h="100%"
                type="auto"
                scrollbarSize={6}
                className={classes.contextSearchResults}
              >
                <Stack gap={4} pr={4}>
                  {searchItems.map((source) => {
                    const selected = selectedIdentities.has(
                      `${source.sourceType}:${source.sourceId}`,
                    );
                    const breadcrumbs =
                      source.breadcrumbs.length > 0
                        ? source.breadcrumbs.join(" / ")
                        : t("ai.context.spaceRoot");
                    return (
                      <Tooltip
                        key={`${source.sourceType}:${source.sourceId}`}
                        label={breadcrumbs}
                        withArrow
                      >
                        <Button
                          variant="subtle"
                          justify="flex-start"
                          leftSection={sourceIcon(source)}
                          disabled={selected || props.sources.length >= 10}
                          className={classes.contextSearchResult}
                          onClick={async () => {
                            try {
                              await props.onAddSource(source);
                              setSearchOpened(false);
                            } catch {
                              // The context menu exposes the save error and retry.
                            }
                          }}
                        >
                          <Box className={classes.contextSearchResultText}>
                            <Text size="sm" fw={500} truncate>
                              {source.title || t("ai.untitled")}
                            </Text>
                            <Text size="xs" c="dimmed" truncate>
                              {breadcrumbs}
                            </Text>
                          </Box>
                        </Button>
                      </Tooltip>
                    );
                  })}
                  {search.hasNextPage && (
                    <Button
                      variant="subtle"
                      loading={search.isFetchingNextPage}
                      onClick={() => void search.fetchNextPage()}
                    >
                      {t("ai.context.loadMore")}
                    </Button>
                  )}
                </Stack>
              </ScrollArea>
            )}
          </Box>
          {!isCoarsePointer && (
            <Text size="xs" c="dimmed" className={classes.contextSearchFooter}>
              {t("ai.context.dragFromSidebarHint")}
            </Text>
          )}
        </Stack>
      </Modal>
    </>
  );
}

function sourceIcon(source: AiContextSource) {
  if (source.icon) {
    return (
      <Text span size="md" lh={1} aria-hidden>
        {source.icon}
      </Text>
    );
  }
  return source.sourceType === "page" ? (
    <IconFileText size={15} />
  ) : source.sourceType === "database_row" ? (
    <IconTableRow size={15} />
  ) : (
    <IconDatabase size={15} />
  );
}
