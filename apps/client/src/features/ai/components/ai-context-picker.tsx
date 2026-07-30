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
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFileText,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconTableRow,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert";
import {
  useAiContextDescendantsQuery,
  useAiContextSourcesQuery,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiChatFile,
  AiContextSource,
  AiDescendantSelection,
  AiDescendantSelectionMode,
  AiPageAttachment,
} from "@/features/ai/types/ai.types.ts";
import classes from "./ai-panel.module.css";
import { dedupeAiContextSources } from "@/features/ai/utils/ai-context.ts";

interface AiContextPickerProps {
  conversationId?: string;
  documentPageId: string;
  documentTitle: string;
  currentDocumentAvailable: boolean;
  includeCurrentDocument: boolean;
  currentDocumentDescendants: AiDescendantSelection;
  sources: AiContextSource[];
  resolvedSourceCount: number;
  limits: { manualRoots: number; resolvedSources: number };
  fileIds: string[];
  attachmentIds: string[];
  chatFiles: AiChatFile[];
  pageAttachments: AiPageAttachment[];
  loadingFiles: boolean;
  saving: boolean;
  saveFailed: boolean;
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
  pendingSource?: AiContextSource | null;
  onPendingSourceHandled?: () => void;
  onToggleCurrentDocument: (included: boolean) => Promise<unknown>;
  onSetCurrentDocumentDescendants: (
    selection: AiDescendantSelection,
  ) => Promise<unknown>;
  onAddSource: (source: AiContextSource) => Promise<unknown>;
  onRemoveSource: (source: AiContextSource) => Promise<unknown>;
  onSetSourceDescendants: (
    source: AiContextSource,
    selection: AiDescendantSelection,
  ) => Promise<unknown>;
  onToggleFile: (fileId: string, included: boolean) => Promise<unknown>;
  onToggleAttachment: (
    attachmentId: string,
    included: boolean,
  ) => Promise<unknown>;
  onUpload: (files: File[]) => Promise<void>;
  onDeleteFile: (fileId: string, fileName: string) => void;
  onRetrySave: () => Promise<void>;
  onPrepareConversation?: () => Promise<unknown>;
}

interface SelectionTarget {
  rootPageId: string;
  title: string;
  selectedPageIds: string[];
  apply: (selection: AiDescendantSelection) => Promise<unknown>;
}

interface ScopeTarget {
  source: AiContextSource;
  complete: (selection: AiDescendantSelection) => Promise<unknown>;
  cancel?: () => void;
}

export function AiContextPicker(props: AiContextPickerProps) {
  const { t } = useTranslation();
  const [searchOpened, setSearchOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [selectionTarget, setSelectionTarget] =
    useState<SelectionTarget | null>(null);
  const [scopeTarget, setScopeTarget] = useState<ScopeTarget | null>(null);
  useModalBackgroundInert(
    searchOpened || Boolean(selectionTarget) || Boolean(scopeTarget),
  );
  const pendingSourceRef = useRef<string | null>(null);
  const contextButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const includedPageIds = useMemo(() => {
    const ids = new Set(props.sources.map((source) => source.pageId));
    if (props.includeCurrentDocument) ids.add(props.documentPageId);
    for (const source of props.sources) {
      source.descendants.pageIds.forEach((pageId) => ids.add(pageId));
    }
    props.currentDocumentDescendants.pageIds.forEach((pageId) =>
      ids.add(pageId),
    );
    return ids;
  }, [
    props.currentDocumentDescendants.pageIds,
    props.documentPageId,
    props.includeCurrentDocument,
    props.sources,
  ]);
  const selectedCount =
    props.resolvedSourceCount +
    props.fileIds.length +
    props.attachmentIds.length;

  const openSelection = (
    rootPageId: string,
    title: string,
    selection: AiDescendantSelection,
    apply: SelectionTarget["apply"],
  ) => {
    props.onOpenedChange?.(false);
    window.requestAnimationFrame(() =>
      setSelectionTarget({
        rootPageId,
        title,
        selectedPageIds: selection.pageIds,
        apply,
      }),
    );
  };

  const closeSearch = (returnFocus = true) => {
    setSearchOpened(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => contextButtonRef.current?.focus());
    }
  };

  const openSearch = async () => {
    props.onOpenedChange?.(false);
    await props.onPrepareConversation?.();
    window.requestAnimationFrame(() => setSearchOpened(true));
  };

  const setCurrentMode = async (mode: AiDescendantSelectionMode) => {
    if (mode === "selected") {
      openSelection(
        props.documentPageId,
        props.documentTitle,
        props.currentDocumentDescendants,
        props.onSetCurrentDocumentDescendants,
      );
      return;
    }
    await props.onSetCurrentDocumentDescendants({ mode, pageIds: [] });
  };

  const setSourceMode = async (
    source: AiContextSource,
    mode: AiDescendantSelectionMode,
  ) => {
    if (mode === "selected") {
      openSelection(
        source.pageId,
        source.title,
        source.descendants,
        (selection) => props.onSetSourceDescendants(source, selection),
      );
      return;
    }
    await props.onSetSourceDescendants(source, { mode, pageIds: [] });
  };

  const addSource = async (source: AiContextSource) => {
    if (source.sourceType === "page" && source.hasChildren) {
      setScopeTarget({
        source,
        complete: async (selection) => {
          await props.onAddSource({ ...source, descendants: selection });
          closeSearch();
        },
      });
      return;
    }
    await props.onAddSource(source);
    closeSearch();
  };

  useEffect(() => {
    if (!props.pendingSource) {
      pendingSourceRef.current = null;
      return;
    }
    const source = props.pendingSource;
    if (pendingSourceRef.current === source.pageId) return;
    pendingSourceRef.current = source.pageId;
    if (!source.hasChildren || source.sourceType !== "page") {
      void props
        .onAddSource(source)
        .finally(() => props.onPendingSourceHandled?.());
      return;
    }
    setScopeTarget({
      source,
      complete: async (selection) => {
        await props.onAddSource({ ...source, descendants: selection });
        props.onPendingSourceHandled?.();
      },
      cancel: props.onPendingSourceHandled,
    });
  }, [props.onAddSource, props.onPendingSourceHandled, props.pendingSource]);

  return (
    <>
      <div>
        <Menu
          opened={props.opened}
          onChange={props.onOpenedChange}
          position="top-end"
          width="min(420px, calc(100vw - 24px))"
          withinPortal
          closeOnItemClick={false}
        >
          <Menu.Target>
            <Button
              ref={contextButtonRef}
              variant="subtle"
              size="compact-sm"
              leftSection={<IconPaperclip size={16} />}
              rightSection={
                <Badge size="xs" variant="light">
                  {props.resolvedSourceCount}/{props.limits.resolvedSources}
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
            <Group justify="space-between" px="xs" py={4}>
              <Text size="xs" fw={600}>
                {t("ai.context.currentDocument")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("ai.context.resolvedCounter", {
                  count: props.resolvedSourceCount,
                  limit: props.limits.resolvedSources,
                })}
              </Text>
            </Group>
            <Box px="xs" pb="xs">
              <Group wrap="nowrap" align="center">
                <Checkbox
                  size="xs"
                  checked={
                    props.currentDocumentAvailable &&
                    props.includeCurrentDocument
                  }
                  disabled={!props.currentDocumentAvailable}
                  label={props.documentTitle || t("ai.untitled")}
                  className={classes.contextFileCheckbox}
                  onChange={(event) =>
                    void props
                      .onToggleCurrentDocument(event.currentTarget.checked)
                      .catch(() => undefined)
                  }
                />
                {props.includeCurrentDocument &&
                  props.currentDocumentAvailable && (
                    <ScopeSelect
                      value={props.currentDocumentDescendants.mode}
                      onChange={(mode) =>
                        void setCurrentMode(mode).catch(() => undefined)
                      }
                    />
                  )}
              </Group>
              {!props.currentDocumentAvailable && (
                <Text size="xs" c="orange" mt={4}>
                  {t("ai.context.currentExcluded")}
                </Text>
              )}
            </Box>

            <Divider />
            <Group justify="space-between" px="xs" py={6}>
              <Text size="xs" fw={600}>
                {t("ai.context.addedDocuments")}
              </Text>
              <Badge size="xs" variant="light">
                {props.sources.length}/{props.limits.manualRoots}
              </Badge>
            </Group>
            {props.sources.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" pb="xs">
                {t("ai.context.noAddedDocuments")}
              </Text>
            ) : (
              <Stack gap={5} px="xs" pb="xs">
                {props.sources.map((source) => (
                  <Group
                    key={`${source.sourceType}:${source.sourceId}`}
                    wrap="nowrap"
                    className={classes.contextSourceRow}
                  >
                    {sourceIcon(source)}
                    <Box className={classes.contextSourceTitle}>
                      <Text size="sm" truncate>
                        {source.title || t("ai.untitled")}
                      </Text>
                      {source.breadcrumbs.length > 0 && (
                        <Text size="xs" c="dimmed" truncate>
                          {source.breadcrumbs.join(" / ")}
                        </Text>
                      )}
                    </Box>
                    {source.sourceType === "page" && (
                      <ScopeSelect
                        value={source.descendants.mode}
                        onChange={(mode) =>
                          void setSourceMode(source, mode).catch(
                            () => undefined,
                          )
                        }
                      />
                    )}
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size={32}
                      aria-label={t("ai.context.removeSource")}
                      onClick={() =>
                        void props.onRemoveSource(source).catch(() => undefined)
                      }
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
            <Menu.Item
              leftSection={<IconPlus size={15} />}
              disabled={props.sources.length >= props.limits.manualRoots}
              onClick={() => void openSearch()}
            >
              {t("ai.context.addFromSpace")}
            </Menu.Item>

            <Divider my="xs" />
            <Menu.Label>{t("ai.context.filesAndAttachments")}</Menu.Label>
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
              <Menu.Item key={file.id}>
                <Group gap={4} wrap="nowrap" className={classes.contextFileRow}>
                  <Checkbox
                    size="xs"
                    checked={props.fileIds.includes(file.id)}
                    disabled={file.status !== "ready"}
                    label={file.name}
                    className={classes.contextFileCheckbox}
                    onChange={(event) =>
                      void props
                        .onToggleFile(file.id, event.currentTarget.checked)
                        .catch(() => undefined)
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
                  <Menu.Item key={attachment.id}>
                    <Checkbox
                      size="xs"
                      checked={props.attachmentIds.includes(attachment.id)}
                      label={attachment.fileName}
                      className={classes.contextFileCheckbox}
                      onChange={(event) =>
                        void props
                          .onToggleAttachment(
                            attachment.id,
                            event.currentTarget.checked,
                          )
                          .catch(() => undefined)
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
        onClose={() => closeSearch()}
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
                    const selected = includedPageIds.has(source.pageId);
                    const blocked = selected || !source.available;
                    const breadcrumbs =
                      source.breadcrumbs.length > 0
                        ? source.breadcrumbs.join(" / ")
                        : t("ai.context.spaceRoot");
                    const reason = selected
                      ? t("ai.context.alreadyIncluded")
                      : !source.available
                        ? t("ai.context.sourceExcluded")
                        : breadcrumbs;
                    return (
                      <Tooltip
                        key={`${source.sourceType}:${source.sourceId}`}
                        label={reason}
                        withArrow
                      >
                        <Button
                          variant="subtle"
                          justify="flex-start"
                          leftSection={sourceIcon(source)}
                          disabled={
                            blocked ||
                            props.sources.length >= props.limits.manualRoots
                          }
                          className={classes.contextSearchResult}
                          onClick={() => {
                            if (
                              source.sourceType === "page" &&
                              source.hasChildren
                            ) {
                              closeSearch(false);
                            }
                            void addSource(source).catch(() => undefined);
                          }}
                        >
                          <Box className={classes.contextSearchResultText}>
                            <Text size="sm" fw={500} truncate>
                              {source.title || t("ai.untitled")}
                            </Text>
                            <Text size="xs" c="dimmed" truncate>
                              {reason}
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

      <DescendantSelectionModal
        conversationId={props.conversationId}
        target={selectionTarget}
        onClose={() => setSelectionTarget(null)}
      />
      <Modal
        opened={Boolean(scopeTarget)}
        onClose={() => {
          scopeTarget?.cancel?.();
          setScopeTarget(null);
        }}
        title={t("ai.context.chooseScopeTitle")}
        centered
        size="sm"
      >
        <Stack gap="xs">
          <Text size="sm">{scopeTarget?.source.title || t("ai.untitled")}</Text>
          {(["none", "all"] as const).map((mode) => (
            <Button
              key={mode}
              variant="light"
              justify="flex-start"
              onClick={async () => {
                await scopeTarget?.complete({ mode, pageIds: [] });
                setScopeTarget(null);
              }}
            >
              {t(`ai.context.scope.${mode}`)}
            </Button>
          ))}
          <Button
            variant="light"
            justify="flex-start"
            onClick={() => {
              if (!scopeTarget) return;
              const target = scopeTarget;
              setScopeTarget(null);
              openSelection(
                target.source.pageId,
                target.source.title,
                target.source.descendants,
                target.complete,
              );
            }}
          >
            {t("ai.context.scope.selected")}
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function ScopeSelect({
  value,
  onChange,
}: {
  value: AiDescendantSelectionMode;
  onChange: (mode: AiDescendantSelectionMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      size="xs"
      w={132}
      value={value}
      allowDeselect={false}
      aria-label={t("ai.context.descendantScope")}
      data={[
        { value: "none", label: t("ai.context.scope.none") },
        { value: "all", label: t("ai.context.scope.all") },
        { value: "selected", label: t("ai.context.scope.selected") },
      ]}
      onChange={(next) => next && onChange(next as AiDescendantSelectionMode)}
    />
  );
}

function DescendantSelectionModal({
  conversationId,
  target,
  onClose,
}: {
  conversationId?: string;
  target: SelectionTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const close = () => {
    setSelected(new Set());
    onClose();
  };

  return (
    <Modal
      opened={Boolean(target)}
      onClose={close}
      title={t("ai.context.selectDescendantsTitle", {
        title: target?.title || t("ai.untitled"),
      })}
      centered
      size="md"
      onEnterTransitionEnd={() =>
        setSelected(new Set(target?.selectedPageIds ?? []))
      }
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("ai.context.selectDescendantsHint")}
        </Text>
        <ScrollArea h={360} type="auto">
          {target && (
            <DescendantList
              conversationId={conversationId}
              parentPageId={target.rootPageId}
              selected={selected}
              setSelected={setSelected}
            />
          )}
        </ScrollArea>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {t("ai.context.selectedCount", { count: selected.size })}
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={async () => {
                if (!target) return;
                await target.apply({
                  mode: "selected",
                  pageIds: [...selected],
                });
                close();
              }}
            >
              {t("ai.context.applySelection")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function DescendantList({
  conversationId,
  parentPageId,
  selected,
  setSelected,
}: {
  conversationId?: string;
  parentPageId: string;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const query = useAiContextDescendantsQuery(
    conversationId,
    parentPageId,
    true,
  );
  if (query.isLoading) {
    return (
      <Group justify="center" py="md">
        <Loader size="sm" />
      </Group>
    );
  }
  if (query.isError) {
    return (
      <Text size="sm" c="red" ta="center" py="md">
        {t("ai.context.descendantsLoadFailed")}
      </Text>
    );
  }
  if (!query.data?.items.length) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        {t("ai.context.noChildPages")}
      </Text>
    );
  }
  return (
    <Stack gap={2}>
      {query.data.items.map((source) => (
        <DescendantRow
          key={source.pageId}
          conversationId={conversationId}
          source={source}
          selected={selected}
          setSelected={setSelected}
        />
      ))}
    </Stack>
  );
}

function DescendantRow({
  conversationId,
  source,
  selected,
  setSelected,
}: {
  conversationId?: string;
  source: AiContextSource;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <Box>
      <Group gap={4} wrap="nowrap" className={classes.contextDescendantRow}>
        <ActionIcon
          variant="subtle"
          size={28}
          disabled={!source.hasChildren}
          aria-label={expanded ? t("Collapse") : t("Expand")}
          onClick={() => setExpanded((value) => !value)}
        >
          {source.hasChildren ? (
            expanded ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )
          ) : null}
        </ActionIcon>
        <Checkbox
          size="xs"
          checked={selected.has(source.pageId)}
          label={source.title || t("ai.untitled")}
          onChange={(event) => {
            const next = new Set(selected);
            if (event.currentTarget.checked) next.add(source.pageId);
            else next.delete(source.pageId);
            setSelected(next);
          }}
        />
      </Group>
      {expanded && (
        <Box ml={24}>
          <DescendantList
            conversationId={conversationId}
            parentPageId={source.pageId}
            selected={selected}
            setSelected={setSelected}
          />
        </Box>
      )}
    </Box>
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
