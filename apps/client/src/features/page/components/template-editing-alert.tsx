import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconHistory,
  IconRefresh,
  IconSend,
  IconTemplate,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import {
  getPageTemplateRevisions,
  getPageTemplateSyncRuns,
  getPageTemplateUsages,
  isCollaborationUnavailable,
  preflightPageTemplatePublish,
  publishPageTemplate,
  retryPageTemplateSyncRun,
} from "@/features/page-template/services/page-template-api";
import { hashNormalizedTemplateDraft } from "@/features/page-template/services/page-template-draft-hash";
import type {
  TemplateKind,
  TemplatePublishPreflight,
  TemplateRevision,
  TemplateSyncRun,
} from "@/features/page-template/types/page-template.types";
import { summarizeTemplateDiff } from "@docmost/editor-ext";
import { TemplateRevisionPreview } from "./template-revision-preview";
import {
  getTemplateSyncErrorLabel,
  getTemplateSyncRunLabel,
  isTemplateSyncRunNonTerminal,
} from "./template-sync-status";
import {
  pageEditorAtom,
  pageEditorUnsyncedChangesAtom,
} from "@/features/editor/atoms/editor-atoms";

type RevisionWithContent = TemplateRevision;

interface TemplateEditingAlertProps {
  pageId: string;
  kind: TemplateKind;
  editable: boolean;
}

const TEMPLATE_SYNC_POLL_INTERVAL_MS = 2_500;
const TEMPLATE_DRAFT_HASH_DEBOUNCE_MS = 150;

export function TemplateEditingAlert({
  pageId,
  kind,
  editable,
}: TemplateEditingAlertProps) {
  const { t, i18n } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const unsyncedChanges = useAtomValue(pageEditorUnsyncedChangesAtom);
  const [preflight, setPreflight] = useState<TemplatePublishPreflight | null>(
    null,
  );
  const [preparing, setPreparing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false);
  const [historyOpened, setHistoryOpened] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(
    kind === "synced" && editable,
  );
  const [metadataError, setMetadataError] = useState(false);
  const [syncRunsError, setSyncRunsError] = useState(false);
  const [revisions, setRevisions] = useState<RevisionWithContent[]>([]);
  const [revisionNextCursor, setRevisionNextCursor] = useState<string | null>(
    null,
  );
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [runs, setRuns] = useState<TemplateSyncRun[]>([]);
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const [previewRevision, setPreviewRevision] =
    useState<RevisionWithContent | null>(null);
  const [compareRevision, setCompareRevision] =
    useState<RevisionWithContent | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [draftHash, setDraftHash] = useState<string | null>(null);
  const [draftHashLoading, setDraftHashLoading] = useState(
    kind === "synced" && editable,
  );
  const [draftUpdateVersion, setDraftUpdateVersion] = useState(0);
  const [collaborationRecoveryAction, setCollaborationRecoveryAction] =
    useState<"preflight" | "publish" | null>(null);

  const loadMetadata = useCallback(
    async ({
      silent = false,
      preserveRevisions = false,
    }: { silent?: boolean; preserveRevisions?: boolean } = {}) => {
      if (kind !== "synced" || !editable) return;
      if (!silent) setMetadataLoading(true);
      try {
        const [revisionResult, runResult, usageResult] = await Promise.all([
          getPageTemplateRevisions(pageId),
          getPageTemplateSyncRuns(pageId),
          getPageTemplateUsages(pageId),
        ]);
        setRevisions((current) =>
          preserveRevisions
            ? [
                ...revisionResult.items,
                ...current.filter(
                  (revision) =>
                    !revisionResult.items.some(
                      (latest) => latest.id === revision.id,
                    ),
                ),
              ]
            : revisionResult.items,
        );
        if (!preserveRevisions) {
          setRevisionNextCursor(revisionResult.nextCursor);
        }
        setRuns(runResult.items);
        setUsageCount(usageResult.totalCount);
        setMetadataError(false);
        setSyncRunsError(false);
      } catch (error) {
        setMetadataError(true);
        throw error;
      } finally {
        if (!silent) setMetadataLoading(false);
      }
    },
    [editable, kind, pageId],
  );

  const pollSyncRuns = useCallback(async () => {
    if (kind !== "synced" || !editable) return;
    try {
      const result = await getPageTemplateSyncRuns(pageId);
      setRuns(result.items);
      setSyncRunsError(false);
    } catch {
      setSyncRunsError(true);
    }
  }, [editable, kind, pageId]);

  useEffect(() => {
    void loadMetadata().catch(() => undefined);
  }, [loadMetadata]);

  useEffect(() => {
    if (kind !== "synced" || !editable || !editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setDraftUpdateVersion((current) => current + 1);
      }, TEMPLATE_DRAFT_HASH_DEBOUNCE_MS);
    };
    editor.on("update", handleUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", handleUpdate);
    };
  }, [editable, editor, kind]);

  useEffect(() => {
    if (kind !== "synced" || !editable || !editor) {
      setDraftHash(null);
      setDraftHashLoading(false);
      return;
    }
    if (unsyncedChanges > 0) return;
    let cancelled = false;
    setDraftHashLoading(true);
    void hashNormalizedTemplateDraft(editor.getJSON())
      .then((hash) => {
        if (!cancelled) setDraftHash(hash);
      })
      .finally(() => {
        if (!cancelled) setDraftHashLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftUpdateVersion, editable, editor, kind, unsyncedChanges]);

  const latestRun = runs[0];

  useEffect(() => {
    if (!isTemplateSyncRunNonTerminal(latestRun?.status)) return;
    const timer = window.setInterval(() => {
      void pollSyncRuns();
    }, TEMPLATE_SYNC_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [latestRun?.status, pollSyncRuns]);

  const comparison = useMemo(() => {
    if (!previewRevision || !compareRevision) return null;
    return summarizeTemplateDiff(
      compareRevision.content,
      previewRevision.content,
    );
  }, [compareRevision, previewRevision]);

  const preparePublish = async ({
    allowWhilePublishing = false,
  }: { allowWhilePublishing?: boolean } = {}) => {
    if (
      !editor ||
      unsyncedChanges > 0 ||
      !hasDraftChanges ||
      preparing ||
      (!allowWhilePublishing && publishing)
    ) {
      return;
    }
    setPreparing(true);
    setCollaborationRecoveryAction(null);
    try {
      const nextPreflight = await preflightPageTemplatePublish(pageId);
      setPreflight(nextPreflight);
      setDestructiveConfirmed(false);
    } catch (error: any) {
      if (isCollaborationUnavailable(error)) {
        setCollaborationRecoveryAction("preflight");
      } else {
        notifications.show({
          color: "red",
          message:
            error?.response?.data?.message ??
            t("Could not prepare publication."),
        });
      }
    } finally {
      setPreparing(false);
    }
  };

  const publish = async () => {
    if (!preflight) return;
    let refreshPreflight = false;
    setPublishing(true);
    setCollaborationRecoveryAction(null);
    try {
      const result = await publishPageTemplate({
        pageId,
        draftHash: preflight.draftHash,
        confirmationToken: preflight.requiresDestructiveConfirmation
          ? (preflight.confirmationToken ?? undefined)
          : undefined,
      });
      setRuns((current) => [
        result.syncRun,
        ...current.filter((run) => run.id !== result.syncRun.id),
      ]);
      setPreflight(null);
      await loadMetadata({ silent: true }).catch(() => undefined);
      notifications.show({
        message: t("Template version {{version}} published.", {
          version: result.revision.revision,
        }),
      });
    } catch (error: any) {
      if (error?.response?.data?.code === "page_template_draft_changed") {
        setPreflight(null);
        refreshPreflight = true;
      } else if (isCollaborationUnavailable(error)) {
        setCollaborationRecoveryAction("publish");
      } else {
        notifications.show({
          color: "red",
          message:
            error?.response?.data?.message ?? t("Could not publish template."),
        });
      }
    } finally {
      setPublishing(false);
    }
    if (refreshPreflight) {
      await waitForDraftSync(350);
      await preparePublish({ allowWhilePublishing: true });
    }
  };

  const openHistory = async () => {
    setPreviewRevision(null);
    setCompareRevision(null);
    setHistoryOpened(true);
    setHistoryLoading(true);
    try {
      await loadMetadata({ silent: true });
    } catch {
      notifications.show({
        color: "red",
        message: t("Could not load template history."),
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!revisionNextCursor || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const result = await getPageTemplateRevisions(pageId, revisionNextCursor);
      setRevisions((current) => [
        ...current,
        ...result.items.filter(
          (revision) =>
            !current.some((existing) => existing.id === revision.id),
        ),
      ]);
      setRevisionNextCursor(result.nextCursor);
    } catch {
      notifications.show({
        color: "red",
        message: t("Could not load template history."),
      });
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const hasDestructiveRemoval =
    preflight?.requiresDestructiveConfirmation ?? false;
  const hasConfirmedFilledRemoval = Boolean(
    preflight?.filledRemovedFieldInstanceCountExact &&
      preflight.filledRemovedFieldInstanceCount > 0,
  );

  const retryRun = async (runId: string) => {
    setRetryingRunId(runId);
    try {
      await retryPageTemplateSyncRun(pageId, runId);
      await pollSyncRuns();
      notifications.show({ message: t("Synchronization retry started") });
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ??
          t("Could not retry synchronization."),
      });
    } finally {
      setRetryingRunId(null);
    }
  };

  const latestPublishedHash = revisions[0]?.contentHash ?? null;
  const hasDraftChanges =
    kind === "synced" &&
    draftHash !== null &&
    (latestPublishedHash === null || draftHash !== latestPublishedHash);
  const hasRecoveryError = metadataError || syncRunsError;
  const publishDisabledReason = !editable
    ? t("Read only")
    : hasRecoveryError
      ? t("Could not load template details.")
      : !editor
        ? t("The editor is still loading.")
        : unsyncedChanges > 0
          ? t("Wait until your changes are saved before publishing.")
          : metadataLoading || draftHashLoading || draftHash === null
            ? t("Checking draft changes")
            : !hasDraftChanges
              ? t("No draft changes to publish.")
              : preparing || publishing
                ? t("Preparing publication")
                : null;
  const editorStatus = resolveEditorStatus({
    t,
    editable,
    metadataError: hasRecoveryError,
    preparing: preparing || publishing,
    latestRun,
    unsyncedChanges,
    hasDraftChanges,
  });
  const progress =
    latestRun?.status === "running" && latestRun.totalCount > 0
      ? Math.min(100, (latestRun.processedCount / latestRun.totalCount) * 100)
      : null;
  const showConcurrentDraftChanges =
    Boolean(latestRun && latestRun.status !== "completed") &&
    (unsyncedChanges > 0 || hasDraftChanges);

  return (
    <>
      <Paper
        component="section"
        withBorder
        radius="md"
        px="sm"
        py={8}
        mb="sm"
        aria-label={t("Template editor")}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            <IconTemplate size={18} aria-hidden="true" />
            <Text fw={650} size="sm">
              {t("Template editor")}
            </Text>
            <Badge size="sm" variant="light" c="var(--mantine-color-text)">
              {kind === "synced" ? t("Linked page") : t("Independent copy")}
            </Badge>
            {kind === "synced" && revisions[0] && (
              <Badge size="sm" variant="outline">
                {t("Published v{{version}}", {
                  version: revisions[0].revision,
                })}
              </Badge>
            )}
            {kind === "synced" && usageCount !== null && (
              <Text size="xs" c="dimmed">
                {t("{{count}} linked pages", { count: usageCount })}
              </Text>
            )}
            {metadataLoading && <Loader size={14} />}
          </Group>

          <Group gap="xs" wrap="wrap">
            <Badge
              size="sm"
              variant="light"
              color={editorStatus.color}
              c="var(--mantine-color-text)"
              leftSection={editorStatus.icon}
              aria-live="polite"
            >
              {editorStatus.label}
            </Badge>
            {showConcurrentDraftChanges && (
              <Badge
                size="sm"
                variant="light"
                color="orange"
                c="var(--mantine-color-text)"
              >
                {t("Draft changes")}
              </Badge>
            )}
            {latestRun?.status === "partial" && (
              <Text size="xs" c="red">
                {t("{{count}} errors", { count: latestRun.failedCount })}
              </Text>
            )}
            {latestRun && ["partial", "failed"].includes(latestRun.status) && (
              <Text size="xs" c="dimmed">
                {getTemplateSyncErrorLabel(latestRun.errorCode, t)}
              </Text>
            )}
            {editable && hasRecoveryError && (
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconRefresh size={14} />}
                onClick={() => void loadMetadata()}
              >
                {t("Retry")}
              </Button>
            )}
            {kind === "synced" && editable && (
              <Button
                size="compact-sm"
                variant="subtle"
                leftSection={<IconHistory size={15} />}
                onClick={() => void openHistory()}
              >
                {t("History")}
              </Button>
            )}
            {kind === "synced" && editable && (
              <Tooltip
                label={publishDisabledReason}
                disabled={!publishDisabledReason}
                withArrow
              >
                <span>
                  <Button
                    size="compact-sm"
                    leftSection={<IconSend size={15} />}
                    loading={preparing || publishing}
                    disabled={Boolean(publishDisabledReason)}
                    onClick={() => void preparePublish()}
                  >
                    {t("Review and publish")}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Group>
        </Group>
        {progress !== null && latestRun && (
          <Group gap="xs" mt={6} aria-live="polite">
            <Progress value={progress} size="xs" style={{ flex: 1 }} />
            <Text size="xs" c="dimmed">
              {t("{{processed}} of {{total}} pages updated", {
                processed: latestRun.processedCount,
                total: latestRun.totalCount,
              })}
            </Text>
          </Group>
        )}
        {publishDisabledReason && editable && !preparing && !publishing && (
          <Text size="xs" c="dimmed" mt={4} ta="right">
            {publishDisabledReason}
          </Text>
        )}
        {collaborationRecoveryAction && editable && (
          <Alert
            color="red"
            icon={<IconAlertTriangle size={18} />}
            mt="sm"
            role="alert"
          >
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">
                {t(
                  "Live editing is temporarily unavailable. Your input is preserved. Try again.",
                )}
              </Text>
              <Button
                size="compact-sm"
                variant="light"
                leftSection={<IconRefresh size={15} />}
                loading={preparing || publishing}
                onClick={() =>
                  collaborationRecoveryAction === "publish"
                    ? void publish()
                    : void preparePublish()
                }
              >
                {t("Retry")}
              </Button>
            </Group>
          </Alert>
        )}
      </Paper>

      <Modal
        opened={Boolean(preflight)}
        onClose={() => setPreflight(null)}
        title={t("Publish template version {{version}}", {
          version: preflight?.nextRevision ?? "",
        })}
        centered
        size="lg"
        closeButtonProps={{ "aria-label": t("Close") }}
      >
        {preflight && (
          <Stack>
            <Text size="sm" c="dimmed">
              {t("{{count}} linked pages will be updated after publication.", {
                count: preflight.activeInstanceCount,
              })}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Paper withBorder p="sm" radius="md">
                <Text fw={600} size="sm" mb={4}>
                  {t("Shared content")}
                </Text>
                <Text size="sm">
                  {t(
                    "{{added}} shared sections added, {{changed}} changed, {{moved}} moved, {{removed}} removed.",
                    {
                      added: preflight.diff.addedBlockIds.length,
                      changed: preflight.diff.changedBlockIds.length,
                      moved: preflight.diff.movedBlockIds.length,
                      removed: preflight.diff.removedBlockIds.length,
                    },
                  )}
                </Text>
              </Paper>
              <Paper withBorder p="sm" radius="md">
                <Text fw={600} size="sm" mb={4}>
                  {t("Editable fields")}
                </Text>
                <Text size="sm">
                  {t(
                    "{{added}} fields added, {{removed}} removed, {{renamed}} renamed.",
                    {
                      added: preflight.diff.addedFields.length,
                      removed: preflight.diff.removedFields.length,
                      renamed: preflight.diff.renamedFields.length,
                    },
                  )}
                </Text>
                <TemplateFieldChanges preflight={preflight} />
              </Paper>
            </SimpleGrid>
            {hasDestructiveRemoval && (
              <Alert
                color="red"
                icon={<IconAlertTriangle size={18} />}
                title={
                  hasConfirmedFilledRemoval
                    ? t("Filled fields will be deleted")
                    : t("Fields will be removed from linked pages")
                }
              >
                <Stack gap="sm">
                  <Text size="sm">
                    {hasConfirmedFilledRemoval
                      ? t(
                          "Values on {{count}} linked pages will be permanently deleted. This cannot be undone.",
                          {
                            count: preflight.filledRemovedFieldInstanceCount,
                          },
                        )
                      : !preflight.filledRemovedFieldInstanceCountExact &&
                          preflight.filledRemovedFieldInstanceCount > 0
                        ? t(
                            "Up to {{count}} linked pages may contain values that will be permanently deleted. Not every page could be checked.",
                            {
                              count: preflight.filledRemovedFieldInstanceCount,
                            },
                          )
                        : t(
                            "These fields will be permanently removed from linked pages. Values entered after this check will also be deleted.",
                          )}
                  </Text>
                  <Checkbox
                    checked={destructiveConfirmed}
                    onChange={(event) =>
                      setDestructiveConfirmed(event.currentTarget.checked)
                    }
                    label={
                      hasConfirmedFilledRemoval ||
                      (!preflight.filledRemovedFieldInstanceCountExact &&
                        preflight.filledRemovedFieldInstanceCount > 0)
                        ? t(
                            "I understand that these field values will be deleted",
                          )
                        : t("I understand that these fields cannot be restored")
                    }
                  />
                </Stack>
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPreflight(null)}>
                {t("Cancel")}
              </Button>
              <Button
                color={hasDestructiveRemoval ? "red" : "blue"}
                loading={publishing}
                disabled={hasDestructiveRemoval && !destructiveConfirmed}
                onClick={() => void publish()}
              >
                {t("Publish version {{version}}", {
                  version: preflight.nextRevision,
                })}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={historyOpened}
        onClose={() => {
          setHistoryOpened(false);
          setPreviewRevision(null);
          setCompareRevision(null);
        }}
        title={
          previewRevision
            ? t("Version {{version}}", {
                version: previewRevision.revision,
              })
            : t("Template history")
        }
        centered
        size={previewRevision ? "xl" : "lg"}
        closeButtonProps={{ "aria-label": t("Close") }}
      >
        {historyLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : previewRevision ? (
          <RevisionComparison
            previewRevision={previewRevision}
            compareRevision={compareRevision}
            comparison={comparison}
            onBack={() => {
              setPreviewRevision(null);
              setCompareRevision(null);
            }}
          />
        ) : metadataError ? (
          <Stack align="center" py="lg">
            <IconAlertTriangle size={24} color="var(--mantine-color-red-6)" />
            <Text c="dimmed" ta="center">
              {t("Could not load template history.")}
            </Text>
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => void openHistory()}
            >
              {t("Retry")}
            </Button>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={460}>
            <Stack>
              {revisions.length === 0 ? (
                <Text c="dimmed" ta="center" py="lg">
                  {t("No published versions yet")}
                </Text>
              ) : (
                revisions.map((revision) => {
                  const run = runs.find(
                    (candidate) => candidate.revision === revision.revision,
                  );
                  const revisionIndex = revisions.findIndex(
                    (candidate) => candidate.id === revision.id,
                  );
                  const previousRevision = revisions[revisionIndex + 1] ?? null;
                  return (
                    <Group
                      key={revision.id}
                      justify="space-between"
                      p="sm"
                      style={{
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: "var(--mantine-radius-md)",
                      }}
                    >
                      <div>
                        <Text fw={600}>
                          {t("Version {{version}}", {
                            version: revision.revision,
                          })}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {new Date(revision.createdAt).toLocaleString(
                            i18n.language,
                          )}
                        </Text>
                      </div>
                      <Group gap="xs">
                        {run && (
                          <Stack gap={2} align="flex-end">
                            <TemplateRunBadge run={run} />
                            {["partial", "failed"].includes(run.status) && (
                              <Text size="xs" c="dimmed">
                                {getTemplateSyncErrorLabel(run.errorCode, t)}
                              </Text>
                            )}
                          </Stack>
                        )}
                        {run &&
                          run.id === latestRun?.id &&
                          ["partial", "failed"].includes(run.status) && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              loading={retryingRunId === run.id}
                              onClick={() => void retryRun(run.id)}
                            >
                              {t("Retry failed pages")}
                            </Button>
                          )}
                        <Button
                          size="compact-xs"
                          variant="default"
                          onClick={() => {
                            setPreviewRevision(revision);
                            setCompareRevision(previousRevision);
                          }}
                        >
                          {previousRevision ? t("View and compare") : t("View")}
                        </Button>
                      </Group>
                    </Group>
                  );
                })
              )}
              {revisionNextCursor && (
                <Button
                  variant="subtle"
                  loading={historyLoadingMore}
                  onClick={() => void loadMoreHistory()}
                >
                  {t("Load more")}
                </Button>
              )}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Modal>
    </>
  );
}

function TemplateFieldChanges({
  preflight,
}: {
  preflight: TemplatePublishPreflight;
}) {
  const { t } = useTranslation();
  const changes = [
    ...preflight.diff.addedFields.map((field) => `+ ${field.label}`),
    ...preflight.diff.removedFields.map((field) => `− ${field.label}`),
    ...preflight.diff.renamedFields.map(
      (field) => `${field.previousLabel} → ${field.nextLabel}`,
    ),
  ];
  if (changes.length === 0) return null;
  return (
    <Stack gap={2} mt="xs" aria-label={t("Changes")}>
      {changes.map((change) => (
        <Text key={change} size="xs" c="dimmed">
          {change}
        </Text>
      ))}
    </Stack>
  );
}

function RevisionComparison({
  previewRevision,
  compareRevision,
  comparison,
  onBack,
}: {
  previewRevision: RevisionWithContent;
  compareRevision: RevisionWithContent | null;
  comparison: ReturnType<typeof summarizeTemplateDiff> | null;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Group justify="space-between">
        <Button
          size="compact-sm"
          variant="subtle"
          leftSection={<IconArrowLeft size={15} />}
          onClick={onBack}
        >
          {t("Back")}
        </Button>
        {comparison && compareRevision && (
          <Text size="sm" c="dimmed">
            {t(
              "{{added}} blocks added, {{changed}} changed, {{moved}} moved, {{removed}} removed.",
              {
                added: comparison.addedBlockIds.length,
                changed: comparison.changedBlockIds.length,
                moved: comparison.movedBlockIds.length,
                removed: comparison.removedBlockIds.length,
              },
            )}
          </Text>
        )}
      </Group>
      {comparison && (
        <Text size="sm" c="dimmed">
          {t(
            "{{added}} fields added, {{removed}} removed, {{renamed}} renamed.",
            {
              added: comparison.addedFields.length,
              removed: comparison.removedFields.length,
              renamed: comparison.renamedFields.length,
            },
          )}
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, md: compareRevision ? 2 : 1 }}>
        {compareRevision && (
          <Stack gap="xs">
            <Text fw={600} size="sm">
              {t("Version {{version}}", {
                version: compareRevision.revision,
              })}
            </Text>
            <TemplateRevisionPreview
              content={compareRevision.content}
              label={t("Version {{version}}", {
                version: compareRevision.revision,
              })}
            />
          </Stack>
        )}
        <Stack gap="xs">
          <Text fw={600} size="sm">
            {t("Version {{version}}", {
              version: previewRevision.revision,
            })}
          </Text>
          <TemplateRevisionPreview
            content={previewRevision.content}
            label={t("Version {{version}}", {
              version: previewRevision.revision,
            })}
          />
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}

function TemplateRunBadge({ run }: { run: TemplateSyncRun }) {
  const { t } = useTranslation();
  const label = getTemplateSyncRunLabel(run.status, t);
  const color =
    run.status === "failed"
      ? "red"
      : run.status === "partial"
        ? "orange"
        : run.status === "completed"
          ? "green"
          : "blue";
  return (
    <Badge variant="light" color={color} c="var(--mantine-color-text)">
      {label}
    </Badge>
  );
}

function resolveEditorStatus({
  t,
  editable,
  metadataError,
  preparing,
  latestRun,
  unsyncedChanges,
  hasDraftChanges,
}: {
  t: (key: string, values?: Record<string, unknown>) => string;
  editable: boolean;
  metadataError: boolean;
  preparing: boolean;
  latestRun?: TemplateSyncRun;
  unsyncedChanges: number;
  hasDraftChanges: boolean;
}) {
  if (!editable) {
    return {
      label: t("Read only"),
      color: "gray",
      icon: <IconTemplate size={12} />,
    };
  }
  if (metadataError) {
    return {
      label: t("Update failed"),
      color: "red",
      icon: <IconAlertTriangle size={12} />,
    };
  }
  if (preparing) {
    return {
      label: t("Preparing publication"),
      color: "blue",
      icon: <IconClock size={12} />,
    };
  }
  if (latestRun?.status === "pending") {
    return {
      label: t("Queued"),
      color: "blue",
      icon: <IconClock size={12} />,
    };
  }
  if (latestRun?.status === "running") {
    return {
      label: t("Updating"),
      color: "blue",
      icon: <IconRefresh size={12} />,
    };
  }
  if (latestRun?.status === "partial") {
    return {
      label: t("Partially updated"),
      color: "orange",
      icon: <IconAlertTriangle size={12} />,
    };
  }
  if (latestRun?.status === "failed") {
    return {
      label: t("Update failed"),
      color: "red",
      icon: <IconAlertTriangle size={12} />,
    };
  }
  if (unsyncedChanges > 0 || hasDraftChanges) {
    return {
      label: t("Draft changes"),
      color: "orange",
      icon: <IconClock size={12} />,
    };
  }
  return {
    label: t("Saved"),
    color: "green",
    icon: <IconCheck size={12} />,
  };
}

function waitForDraftSync(delay: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}
