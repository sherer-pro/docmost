import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Group,
  Indicator,
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
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useDrop } from "react-dnd";
import { useTranslation } from "react-i18next";
import { useAiContextSourcesQuery } from "@/features/ai/queries/ai-query.ts";
import {
  AiChatFile,
  AiContextSource,
  AiContextSourceType,
  AiPageAttachment,
} from "@/features/ai/types/ai.types.ts";
import { treeNodeToContextSource } from "@/features/ai/utils/ai-context.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import classes from "./ai-panel.module.css";

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
  onToggleCurrentDocument: (included: boolean) => Promise<unknown>;
  onAddSource: (source: AiContextSource) => Promise<unknown>;
  onRemoveSource: (source: AiContextSource) => Promise<unknown>;
  onToggleFile: (fileId: string, included: boolean) => Promise<unknown>;
  onToggleAttachment: (
    attachmentId: string,
    included: boolean,
  ) => Promise<unknown>;
  onUpload: (files: File[]) => Promise<void>;
  onDeleteFile: (fileId: string) => void;
}

export function AiContextPicker(props: AiContextPickerProps) {
  const { t } = useTranslation();
  const [searchOpened, setSearchOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const tree = useAtomValue(treeDataAtom);
  const search = useAiContextSourcesQuery(props.conversationId, debouncedQuery);
  const searchItems = search.data?.pages.flatMap((page) => page.items) ?? [];
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
    (props.includeCurrentDocument ? 1 : 0) +
    props.sources.length +
    props.fileIds.length +
    props.attachmentIds.length;

  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: "NODE",
      canDrop: (item: { id?: string }) => {
        const node = item.id ? findTreeNode(tree, item.id) : undefined;
        return Boolean(node && node.spaceId === props.spaceId);
      },
      drop: (item: { id?: string }) => {
        const node = item.id ? findTreeNode(tree, item.id) : undefined;
        if (!node || node.spaceId !== props.spaceId) {
          notifications.show({
            message: t("ai.context.crossSpaceRejected"),
            color: "orange",
          });
          return;
        }
        const source = treeNodeToContextSource(node);
        if (!source) return;
        if (selectedIdentities.has(`${source.sourceType}:${source.sourceId}`)) {
          notifications.show({ message: t("ai.context.alreadyAdded") });
          return;
        }
        if (props.sources.length >= 10) {
          notifications.show({
            message: t("ai.errorReason.contextSourceLimit"),
            color: "orange",
          });
          return;
        }
        void props.onAddSource(source);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [props, selectedIdentities, t, tree],
  );

  return (
    <>
      <div
        ref={dropRef}
        className={
          isOver
            ? canDrop
              ? classes.contextDropActive
              : classes.contextDropRejected
            : undefined
        }
      >
        <Menu position="top-start" withinPortal>
          <Menu.Target>
            <Indicator
              inline
              size={16}
              label={selectedCount}
              disabled={selectedCount === 0}
              offset={3}
            >
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconPaperclip size={16} />}
                disabled={props.saving}
                className={classes.toolbarButton}
              >
                {t("ai.context.title")}
              </Button>
            </Indicator>
          </Menu.Target>
          <Menu.Dropdown className={classes.contextMenu}>
            <Menu.Label>{t("ai.context.documents")}</Menu.Label>
            <Menu.Item closeMenuOnClick={false}>
              <Checkbox
                size="xs"
                checked={props.includeCurrentDocument}
                label={props.documentTitle || t("ai.untitled")}
                onChange={(event) =>
                  void props.onToggleCurrentDocument(
                    event.currentTarget.checked,
                  )
                }
              />
            </Menu.Item>
            {props.sources.length > 0 && (
              <Pill.Group px="xs" pb={4}>
                {props.sources.map((source) => (
                  <Pill
                    key={`${source.sourceType}:${source.sourceId}`}
                    withRemoveButton
                    onRemove={() => void props.onRemoveSource(source)}
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
                <Group gap={4} wrap="nowrap">
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
                      )
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
                    size={26}
                    aria-label={t("ai.deleteFile")}
                    onClick={() => props.onDeleteFile(file.id)}
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
                        )
                      }
                    />
                  </Menu.Item>
                ))}
              </>
            )}
            <Menu.Label>{t("ai.context.dragHint")}</Menu.Label>
          </Menu.Dropdown>
        </Menu>
      </div>

      <Modal
        opened={searchOpened}
        onClose={() => setSearchOpened(false)}
        title={t("ai.context.searchTitle")}
        centered
      >
        <Stack gap="sm">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("ai.context.searchPlaceholder")}
            leftSection={<IconSearch size={16} />}
            autoFocus
          />
          {search.isLoading && (
            <Group justify="center" py="lg">
              <Loader size="sm" />
            </Group>
          )}
          {search.isError && (
            <Text c="red" size="sm">
              {t("ai.context.searchFailed")}
            </Text>
          )}
          {!search.isLoading && query.trim() && searchItems.length === 0 && (
            <Text c="dimmed" size="sm" ta="center" py="lg">
              {t("ai.context.noResults")}
            </Text>
          )}
          <ScrollArea.Autosize mah={360}>
            <Stack gap={4}>
              {searchItems.map((source) => {
                const selected = selectedIdentities.has(
                  `${source.sourceType}:${source.sourceId}`,
                );
                return (
                  <Tooltip
                    key={`${source.sourceType}:${source.sourceId}`}
                    label={source.breadcrumbs.join(" / ")}
                    disabled={source.breadcrumbs.length === 0}
                    withArrow
                  >
                    <Button
                      variant="subtle"
                      justify="flex-start"
                      leftSection={sourceIcon(source.sourceType)}
                      disabled={selected || props.sources.length >= 10}
                      onClick={async () => {
                        await props.onAddSource(source);
                        setSearchOpened(false);
                      }}
                    >
                      <Text lineClamp={1}>
                        {source.title || t("ai.untitled")}
                      </Text>
                    </Button>
                  </Tooltip>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
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
      </Modal>
    </>
  );
}

function findTreeNode(
  nodes: SpaceTreeNode[],
  id: string,
): SpaceTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findTreeNode(node.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

function sourceIcon(sourceType: AiContextSourceType) {
  return sourceType === "page" ? (
    <IconFileText size={15} />
  ) : (
    <IconDatabase size={15} />
  );
}
