import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowLeft,
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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert";
import {
  useAiContextDescendantsQuery,
  useAiContextSourcesQuery,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiChatFile,
  AiContextSource,
  AiDescendantSelection,
  AiPageAttachment,
} from "@/features/ai/types/ai.types.ts";
import {
  dedupeAiContextSources,
  getAiContextScopeSummary,
  getAiContextTriggerCount,
} from "@/features/ai/utils/ai-context.ts";
import { AI_CHAT_FILE_ACCEPT } from "@/features/ai/utils/ai-files.ts";
import classes from "./ai-panel.module.css";

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
  showTrigger?: boolean;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
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

type ContextManagerView = "overview" | "search" | "scope" | "descendants";

interface ScopeTarget {
  rootPageId: string;
  title: string;
  selection: AiDescendantSelection;
  returnView: "overview" | "search";
  complete: (selection: AiDescendantSelection) => Promise<unknown>;
  cancel?: () => void;
}

interface SelectionTarget {
  rootPageId: string;
  title: string;
  selectedPageIds: string[];
  apply: (selection: AiDescendantSelection) => Promise<unknown>;
}

export function AiContextPicker(props: AiContextPickerProps) {
  const { t } = useTranslation();
  const opened = Boolean(props.opened);
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [view, setView] = useState<ContextManagerView>("overview");
  const [query, setQuery] = useState("");
  const [scopeTarget, setScopeTarget] = useState<ScopeTarget | null>(null);
  const [selectionTarget, setSelectionTarget] =
    useState<SelectionTarget | null>(null);
  const pendingSourceRef = useRef<string | null>(null);
  const contextButtonRef = useRef<HTMLButtonElement | null>(null);
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const search = useAiContextSourcesQuery(props.conversationId, debouncedQuery);
  useModalBackgroundInert(opened);

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
  const selectedCount = getAiContextTriggerCount({
    currentDocumentAvailable: props.currentDocumentAvailable,
    includeCurrentDocument: props.includeCurrentDocument,
    sourceCount: props.sources.length,
    fileCount: props.fileIds.length,
    attachmentCount: props.attachmentIds.length,
  });

  const resetNavigation = () => {
    setView("overview");
    setQuery("");
    setScopeTarget(null);
    setSelectionTarget(null);
  };

  const closeManager = () => {
    scopeTarget?.cancel?.();
    resetNavigation();
    props.onOpenedChange?.(false);
    window.requestAnimationFrame(() =>
      (props.returnFocusRef?.current ?? contextButtonRef.current)?.focus(),
    );
  };

  const openManager = () => {
    props.onOpenedChange?.(true);
  };

  const openSearch = async () => {
    await props.onPrepareConversation?.();
    setView("search");
  };

  const openScope = (target: ScopeTarget) => {
    setScopeTarget(target);
    setSelectionTarget(null);
    setView("scope");
  };

  const completeScope = async (selection: AiDescendantSelection) => {
    if (!scopeTarget) return;
    await scopeTarget.complete(selection);
    setScopeTarget(null);
    setSelectionTarget(null);
    setView("overview");
  };

  const openDescendantSelection = () => {
    if (!scopeTarget) return;
    setSelectionTarget({
      rootPageId: scopeTarget.rootPageId,
      title: scopeTarget.title,
      selectedPageIds: scopeTarget.selection.pageIds,
      apply: completeScope,
    });
    setView("descendants");
  };

  const goBack = () => {
    if (view === "descendants") {
      setSelectionTarget(null);
      setView("scope");
      return;
    }
    if (view === "scope") {
      const returnView = scopeTarget?.returnView ?? "overview";
      scopeTarget?.cancel?.();
      setScopeTarget(null);
      setView(returnView);
      return;
    }
    setView("overview");
  };

  const addSource = async (source: AiContextSource) => {
    if (source.sourceType === "page" && source.hasChildren) {
      openScope({
        rootPageId: source.pageId,
        title: source.title,
        selection: source.descendants,
        returnView: "search",
        complete: (selection) =>
          props.onAddSource({ ...source, descendants: selection }),
      });
      return;
    }
    await props.onAddSource(source);
    setView("overview");
  };

  useEffect(() => {
    if (!props.pendingSource) {
      pendingSourceRef.current = null;
      return;
    }
    const source = props.pendingSource;
    if (pendingSourceRef.current === source.pageId) return;
    pendingSourceRef.current = source.pageId;
    props.onOpenedChange?.(true);
    if (!source.hasChildren || source.sourceType !== "page") {
      void props
        .onAddSource(source)
        .finally(() => props.onPendingSourceHandled?.());
      return;
    }
    openScope({
      rootPageId: source.pageId,
      title: source.title,
      selection: source.descendants,
      returnView: "overview",
      complete: async (selection) => {
        await props.onAddSource({ ...source, descendants: selection });
        props.onPendingSourceHandled?.();
      },
      cancel: props.onPendingSourceHandled,
    });
  }, [props.onAddSource, props.onPendingSourceHandled, props.pendingSource]);

  const title =
    view === "search"
      ? t("ai.context.searchTitle")
      : view === "scope"
        ? t("ai.context.chooseScopeTitle")
        : view === "descendants"
          ? t("ai.context.selectDescendantsTitle", {
              title: selectionTarget?.title || t("ai.untitled"),
            })
          : t("ai.context.managerTitle");

  return (
    <>
      {props.showTrigger !== false && (
        <Button
          ref={contextButtonRef}
          variant="subtle"
          size="compact-sm"
          leftSection={<IconPaperclip size={16} />}
          className={classes.contextButton}
          aria-label={t("ai.context.triggerLabel", { count: selectedCount })}
          onClick={openManager}
        >
          <span className={classes.contextButtonLabel}>
            <span className={classes.contextButtonFullLabel}>
              {t("ai.context.trigger", { count: selectedCount })}
            </span>
            <span className={classes.contextButtonShortLabel} aria-hidden>
              {selectedCount}
            </span>
          </span>
        </Button>
      )}

      <Modal
        opened={opened}
        onClose={closeManager}
        title={
          <Group
            gap="xs"
            wrap="nowrap"
            align="flex-start"
            className={classes.contextManagerTitle}
          >
            {view !== "overview" && (
              <AccessibleActionIcon
                label={t("ai.context.back")}
                variant="subtle"
                onClick={goBack}
              >
                <IconArrowLeft size={18} />
              </AccessibleActionIcon>
            )}
            <Text
              fw={600}
              size="lg"
              className={classes.contextManagerTitleText}
            >
              {title}
            </Text>
          </Group>
        }
        closeButtonProps={{ "aria-label": t("Close") }}
        centered={!isMobile}
        fullScreen={Boolean(isMobile)}
        size="lg"
        classNames={{
          content: classes.contextManagerContent,
          body: classes.contextManagerBody,
        }}
      >
        <Box className={classes.contextManagerLayout} aria-busy={props.saving}>
          <Group
            justify="space-between"
            gap="xs"
            wrap="wrap"
            className={classes.contextManagerIntro}
          >
            {view === "overview" && (
              <Text size="sm" c="dimmed" className={classes.contextManagerLead}>
                {t("ai.context.managerDescription")}
              </Text>
            )}
            <Group gap="xs" wrap="nowrap">
              <Badge variant="light" size="sm">
                {t("ai.context.resolvedCounter", {
                  count: props.resolvedSourceCount,
                  limit: props.limits.resolvedSources,
                })}
              </Badge>
              {props.saving ? (
                <Group gap={5} wrap="nowrap">
                  <Loader size={13} />
                  <Text size="xs" c="dimmed">
                    {t("ai.context.saving")}
                  </Text>
                </Group>
              ) : (
                <Text size="xs" c="dimmed">
                  {t("ai.context.autosaveHint")}
                </Text>
              )}
            </Group>
          </Group>

          {props.saveFailed && (
            <Alert color="red" variant="light" p="xs" radius={0}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm">{t("ai.ux.contextSaveFailed")}</Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  disabled={props.saving}
                  onClick={() => void props.onRetrySave()}
                >
                  {t("ai.tryAgain")}
                </Button>
              </Group>
            </Alert>
          )}

          {view === "overview" && (
            <OverviewView
              {...props}
              onOpenSearch={() => void openSearch().catch(() => undefined)}
              onOpenCurrentScope={() =>
                openScope({
                  rootPageId: props.documentPageId,
                  title: props.documentTitle,
                  selection: props.currentDocumentDescendants,
                  returnView: "overview",
                  complete: props.onSetCurrentDocumentDescendants,
                })
              }
              onOpenSourceScope={(source) =>
                openScope({
                  rootPageId: source.pageId,
                  title: source.title,
                  selection: source.descendants,
                  returnView: "overview",
                  complete: (selection) =>
                    props.onSetSourceDescendants(source, selection),
                })
              }
            />
          )}
          {view === "search" && (
            <SearchView
              query={query}
              setQuery={setQuery}
              search={search}
              searchItems={searchItems}
              includedPageIds={includedPageIds}
              sourceCount={props.sources.length}
              sourceLimit={props.limits.manualRoots}
              saving={props.saving}
              onAddSource={addSource}
            />
          )}
          {view === "scope" && scopeTarget && (
            <ScopeView
              target={scopeTarget}
              saving={props.saving}
              onSelect={(selection) =>
                void completeScope(selection).catch(() => undefined)
              }
              onOpenDescendants={openDescendantSelection}
            />
          )}
          {view === "descendants" && selectionTarget && (
            <DescendantSelectionView
              key={selectionTarget.rootPageId}
              conversationId={props.conversationId}
              target={selectionTarget}
              saving={props.saving}
            />
          )}
        </Box>
      </Modal>
    </>
  );
}

function OverviewView(
  props: AiContextPickerProps & {
    onOpenSearch: () => void;
    onOpenCurrentScope: () => void;
    onOpenSourceScope: (source: AiContextSource) => void;
  },
) {
  const { t } = useTranslation();
  const hasFiles =
    props.chatFiles.length > 0 || props.pageAttachments.length > 0;
  return (
    <ScrollArea className={classes.contextManagerScroll} type="auto">
      <Stack gap="md" p="md">
        <ContextSection
          icon={<IconFileText size={18} />}
          title={t("ai.context.currentDocument")}
          description={t("ai.context.currentDocumentDescription")}
        >
          <Paper withBorder p="sm" className={classes.contextManagerPrimaryRow}>
            <Group justify="space-between" gap="sm" wrap="nowrap">
              <Switch
                checked={
                  props.currentDocumentAvailable && props.includeCurrentDocument
                }
                disabled={!props.currentDocumentAvailable || props.saving}
                label={props.documentTitle || t("ai.untitled")}
                className={classes.contextManagerSwitch}
                onChange={(event) =>
                  void props
                    .onToggleCurrentDocument(event.currentTarget.checked)
                    .catch(() => undefined)
                }
              />
              {props.includeCurrentDocument &&
                props.currentDocumentAvailable && (
                  <ScopeButton
                    selection={props.currentDocumentDescendants}
                    disabled={props.saving}
                    onClick={props.onOpenCurrentScope}
                  />
                )}
            </Group>
            {!props.currentDocumentAvailable && (
              <Text size="xs" c="orange" mt="xs">
                {t("ai.context.currentExcluded")}
              </Text>
            )}
          </Paper>
        </ContextSection>

        <ContextSection
          icon={<IconDatabase size={18} />}
          title={t("ai.context.addedDocuments")}
          description={t("ai.context.addedDocumentsDescription")}
          action={
            <Group gap="xs" wrap="nowrap">
              <Badge variant="light">
                {props.sources.length}/{props.limits.manualRoots}
              </Badge>
              {props.sources.length > 0 && (
                <Button
                  size="compact-sm"
                  leftSection={<IconPlus size={15} />}
                  disabled={
                    props.saving ||
                    props.sources.length >= props.limits.manualRoots
                  }
                  onClick={props.onOpenSearch}
                >
                  {t("ai.context.addFromSpace")}
                </Button>
              )}
            </Group>
          }
        >
          {props.sources.length === 0 ? (
            <EmptyState
              compact
              icon={IconDatabase}
              title={t("ai.context.noAddedDocuments")}
              description={t("ai.context.noAddedDocumentsDescription")}
              action={
                <Button
                  variant="light"
                  size="compact-sm"
                  leftSection={<IconPlus size={15} />}
                  disabled={props.saving}
                  onClick={props.onOpenSearch}
                >
                  {t("ai.context.addFromSpace")}
                </Button>
              }
            />
          ) : (
            <Stack gap="xs">
              {props.sources.map((source) => (
                <Paper
                  key={`${source.sourceType}:${source.sourceId}`}
                  withBorder
                  p="xs"
                  className={classes.contextManagerSourceRow}
                >
                  <Group
                    gap="xs"
                    wrap="nowrap"
                    className={classes.contextSourceTitle}
                  >
                    {sourceIcon(source)}
                    <Box className={classes.contextSourceTitle}>
                      <Text size="sm" fw={500} truncate>
                        {source.title || t("ai.untitled")}
                      </Text>
                      {source.breadcrumbs.length > 0 && (
                        <Text size="xs" c="dimmed" truncate>
                          {source.breadcrumbs.join(" / ")}
                        </Text>
                      )}
                    </Box>
                  </Group>
                  <Group gap={6} wrap="nowrap" justify="flex-end">
                    {source.sourceType === "page" && source.hasChildren && (
                      <ScopeButton
                        selection={source.descendants}
                        disabled={props.saving}
                        onClick={() => props.onOpenSourceScope(source)}
                      />
                    )}
                    <AccessibleActionIcon
                      label={t("ai.context.removeSource")}
                      variant="subtle"
                      color="red"
                      disabled={props.saving}
                      onClick={() =>
                        void props.onRemoveSource(source).catch(() => undefined)
                      }
                    >
                      <IconTrash size={15} />
                    </AccessibleActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </ContextSection>

        <ContextSection
          icon={<IconPaperclip size={18} />}
          title={t("ai.context.filesAndAttachments")}
          description={t("ai.context.filesDescription")}
          action={
            <FileButton
              onChange={(files) => void props.onUpload(files)}
              accept={AI_CHAT_FILE_ACCEPT}
              multiple
            >
              {(fileButtonProps) => (
                <Button
                  {...fileButtonProps}
                  size="compact-sm"
                  leftSection={<IconUpload size={15} />}
                  disabled={props.saving}
                >
                  {t("ai.context.uploadPrivateFiles")}
                </Button>
              )}
            </FileButton>
          }
        >
          <Group gap="xs" mb={hasFiles ? "sm" : 0}>
            <Badge variant="light" color="gray">
              {t("ai.context.privateFilesCounter", {
                count: props.fileIds.length,
                limit: 10,
              })}
            </Badge>
            <Badge variant="light" color="gray">
              {t("ai.context.attachmentsCounter", {
                count: props.attachmentIds.length,
                limit: 20,
              })}
            </Badge>
          </Group>
          {props.loadingFiles ? (
            <Group justify="center" py="lg">
              <Loader size="sm" />
            </Group>
          ) : !hasFiles ? (
            <EmptyState
              compact
              icon={IconPaperclip}
              title={t("ai.context.noFiles")}
              description={t("ai.context.noFilesDescription")}
            />
          ) : (
            <Stack gap="md">
              {props.chatFiles.length > 0 && (
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed">
                    {t("ai.context.privateFiles")}
                  </Text>
                  {props.chatFiles.map((file) => (
                    <Paper
                      key={file.id}
                      withBorder
                      p="xs"
                      className={classes.contextManagerFileRow}
                    >
                      <Checkbox
                        size="sm"
                        checked={props.fileIds.includes(file.id)}
                        disabled={file.status !== "ready" || props.saving}
                        label={file.name}
                        className={classes.contextFileCheckbox}
                        onChange={(event) =>
                          void props
                            .onToggleFile(file.id, event.currentTarget.checked)
                            .catch(() => undefined)
                        }
                      />
                      <Group gap={6} wrap="nowrap">
                        {file.status !== "ready" && (
                          <Badge
                            variant="light"
                            color={file.status === "failed" ? "red" : "blue"}
                            size="xs"
                          >
                            {t(`ai.fileStatus.${file.status}`)}
                          </Badge>
                        )}
                        <AccessibleActionIcon
                          label={`${t("ai.deleteFile")}: ${file.name}`}
                          variant="subtle"
                          color="red"
                          disabled={props.saving}
                          onClick={() => props.onDeleteFile(file.id, file.name)}
                        >
                          <IconTrash size={15} />
                        </AccessibleActionIcon>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              )}
              {props.pageAttachments.length > 0 && (
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed">
                    {t("ai.context.currentDocumentAttachments")}
                  </Text>
                  {props.pageAttachments.map((attachment) => (
                    <Paper key={attachment.id} withBorder p="xs">
                      <Checkbox
                        size="sm"
                        checked={props.attachmentIds.includes(attachment.id)}
                        disabled={props.saving}
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
                    </Paper>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </ContextSection>
      </Stack>
    </ScrollArea>
  );
}

function SearchView({
  query,
  setQuery,
  search,
  searchItems,
  includedPageIds,
  sourceCount,
  sourceLimit,
  saving,
  onAddSource,
}: {
  query: string;
  setQuery: (query: string) => void;
  search: ReturnType<typeof useAiContextSourcesQuery>;
  searchItems: AiContextSource[];
  includedPageIds: Set<string>;
  sourceCount: number;
  sourceLimit: number;
  saving: boolean;
  onAddSource: (source: AiContextSource) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="sm" p="md" className={classes.contextManagerSearchLayout}>
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
          <EmptyState
            compact
            icon={IconSearch}
            title={t("ai.context.searchFailed")}
          />
        ) : query.trim() && searchItems.length === 0 ? (
          <EmptyState
            compact
            icon={IconSearch}
            title={t("ai.context.noResults")}
          />
        ) : (
          <ScrollArea h="100%" type="auto" scrollbarSize={6}>
            <Stack gap="xs" pr={4}>
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
                  <Button
                    key={`${source.sourceType}:${source.sourceId}`}
                    variant="default"
                    justify="flex-start"
                    leftSection={sourceIcon(source)}
                    disabled={saving || blocked || sourceCount >= sourceLimit}
                    className={classes.contextSearchResult}
                    onClick={() =>
                      void onAddSource(source).catch(() => undefined)
                    }
                  >
                    <Box className={classes.contextSearchResultText}>
                      <Text size="sm" fw={500} truncate>
                        {source.title || t("ai.untitled")}
                      </Text>
                      <Text
                        size="xs"
                        c={!source.available ? "orange" : "dimmed"}
                        truncate
                      >
                        {reason}
                      </Text>
                    </Box>
                  </Button>
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
    </Stack>
  );
}

function ScopeView({
  target,
  saving,
  onSelect,
  onOpenDescendants,
}: {
  target: ScopeTarget;
  saving: boolean;
  onSelect: (selection: AiDescendantSelection) => void;
  onOpenDescendants: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ScrollArea className={classes.contextManagerScroll} type="auto">
      <Stack gap="md" p="md">
        <Box>
          <Text fw={600}>{target.title || t("ai.untitled")}</Text>
          <Text size="sm" c="dimmed" mt={4}>
            {t("ai.context.chooseScopeDescription")}
          </Text>
        </Box>
        <ScopeOption
          title={t("ai.context.scope.none")}
          description={t("ai.context.scopeDescription.none")}
          selected={target.selection.mode === "none"}
          disabled={saving}
          onClick={() => onSelect({ mode: "none", pageIds: [] })}
        />
        <ScopeOption
          title={t("ai.context.scope.all")}
          description={t("ai.context.scopeDescription.all")}
          selected={target.selection.mode === "all"}
          disabled={saving}
          onClick={() => onSelect({ mode: "all", pageIds: [] })}
        />
        <ScopeOption
          title={t("ai.context.scope.selected")}
          description={t("ai.context.scopeDescription.selected")}
          selected={target.selection.mode === "selected"}
          badge={t("ai.context.selectedCount", {
            count: target.selection.pageIds.length,
          })}
          disabled={saving}
          onClick={onOpenDescendants}
        />
      </Stack>
    </ScrollArea>
  );
}

function ScopeOption({
  title,
  description,
  selected,
  badge,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  badge?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={selected ? "light" : "default"}
      justify="space-between"
      disabled={disabled}
      onClick={onClick}
      className={classes.contextScopeOption}
    >
      <Group justify="space-between" wrap="nowrap" w="100%">
        <Box className={classes.contextScopeOptionText}>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed" fw={400}>
            {description}
          </Text>
        </Box>
        {badge && <Badge variant="light">{badge}</Badge>}
      </Group>
    </Button>
  );
}

function ScopeButton({
  selection,
  disabled,
  onClick,
}: {
  selection: AiDescendantSelection;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const summary = getAiContextScopeSummary(selection);
  const label = getScopeLabel(t, summary);
  return (
    <Button
      variant="default"
      size="compact-xs"
      rightSection={<IconChevronRight size={13} />}
      disabled={disabled}
      onClick={onClick}
      className={classes.contextManagerScopeButton}
    >
      {label}
    </Button>
  );
}

function getScopeLabel(
  t: TFunction,
  summary: ReturnType<typeof getAiContextScopeSummary>,
): string {
  if (summary.mode === "selected") {
    return t("ai.context.scopeSelectedCount", { count: summary.selectedCount });
  }
  return t(`ai.context.scope.${summary.mode}`);
}

function ContextSection({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="md" className={classes.contextManagerSection}>
      <Group
        justify="space-between"
        gap="sm"
        align="flex-start"
        className={classes.contextManagerSectionHeader}
      >
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Box c="dimmed" mt={2}>
            {icon}
          </Box>
          <Box>
            <Text fw={600}>{title}</Text>
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          </Box>
        </Group>
        {action}
      </Group>
      <Box className={classes.contextManagerSectionBody}>{children}</Box>
    </Paper>
  );
}

function DescendantSelectionView({
  conversationId,
  target,
  saving,
}: {
  conversationId?: string;
  target: SelectionTarget;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(target.selectedPageIds),
  );
  return (
    <Box className={classes.contextDescendantLayout}>
      <Box p="md">
        <Text size="sm" c="dimmed">
          {t("ai.context.selectDescendantsHint")}
        </Text>
      </Box>
      <ScrollArea className={classes.contextDescendantScroll} type="auto">
        <Box px="md" pb="md">
          <DescendantList
            conversationId={conversationId}
            parentPageId={target.rootPageId}
            selected={selected}
            setSelected={setSelected}
          />
        </Box>
      </ScrollArea>
      <Group
        justify="space-between"
        gap="xs"
        className={classes.contextDescendantFooter}
      >
        <Text size="sm" c="dimmed">
          {t("ai.context.selectedCount", { count: selected.size })}
        </Text>
        <Button
          disabled={saving}
          onClick={() =>
            void target
              .apply({ mode: "selected", pageIds: [...selected] })
              .catch(() => undefined)
          }
        >
          {t("ai.context.applySelection")}
        </Button>
      </Group>
    </Box>
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
      <EmptyState
        compact
        icon={IconFileText}
        title={t("ai.context.noChildPages")}
      />
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
        {source.hasChildren ? (
          <AccessibleActionIcon
            variant="subtle"
            size={32}
            minTargetSize={32}
            label={expanded ? t("Collapse") : t("Expand")}
            onClick={() => setExpanded((value) => !value)}
          >
            expanded ? (
            <IconChevronDown size={14} />
            ) : (
            <IconChevronRight size={14} />)
          </AccessibleActionIcon>
        ) : (
          <Box className={classes.contextDescendantToggleSpacer} aria-hidden />
        )}
        <Checkbox
          size="sm"
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
    <IconFileText size={16} />
  ) : source.sourceType === "database_row" ? (
    <IconTableRow size={16} />
  ) : (
    <IconDatabase size={16} />
  );
}
