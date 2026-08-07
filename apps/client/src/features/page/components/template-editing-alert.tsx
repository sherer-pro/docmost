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
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconHistory,
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
  preflightPageTemplatePublish,
  publishPageTemplate,
  retryPageTemplateSyncRun,
} from "@/features/page-template/services/page-template-api";
import type {
  TemplateKind,
  TemplatePublishPreflight,
  TemplateRevision,
  TemplateSyncRun,
} from "@/features/page-template/types/page-template.types";
import { summarizeTemplateDiff } from "@docmost/editor-ext";
import { TemplateRevisionPreview } from "./template-revision-preview";
import {
  pageEditorAtom,
  pageEditorUnsyncedChangesAtom,
} from "@/features/editor/atoms/editor-atoms";

type RevisionWithContent = TemplateRevision & { content: unknown };

interface TemplateEditingAlertProps {
  pageId: string;
  kind: TemplateKind;
  editable: boolean;
}

export function TemplateEditingAlert({
  pageId,
  kind,
  editable,
}: TemplateEditingAlertProps) {
  const { t } = useTranslation();
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
  const [revisions, setRevisions] = useState<RevisionWithContent[]>([]);
  const [runs, setRuns] = useState<TemplateSyncRun[]>([]);
  const [usageCount, setUsageCount] = useState(0);
  const [previewRevision, setPreviewRevision] =
    useState<RevisionWithContent | null>(null);
  const [compareRevision, setCompareRevision] =
    useState<RevisionWithContent | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);

  const loadMetadata = useCallback(async () => {
    if (kind !== "synced") return;
    const [revisionResult, runResult, usageResult] = await Promise.all([
      getPageTemplateRevisions(pageId),
      getPageTemplateSyncRuns(pageId),
      getPageTemplateUsages(pageId),
    ]);
    setRevisions(revisionResult.items);
    setRuns(runResult.items);
    setUsageCount(usageResult.totalCount);
  }, [kind, pageId]);

  useEffect(() => {
    void loadMetadata().catch(() => undefined);
  }, [loadMetadata]);

  const comparison = useMemo(() => {
    if (!previewRevision || !compareRevision) return null;
    return summarizeTemplateDiff(
      compareRevision.content,
      previewRevision.content,
    );
  }, [compareRevision, previewRevision]);

  const preparePublish = async () => {
    if (!editor || unsyncedChanges > 0) return;
    setPreparing(true);
    try {
      const nextPreflight = await preflightPageTemplatePublish(pageId);
      setPreflight(nextPreflight);
      setDestructiveConfirmed(false);
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ??
          t("Could not prepare publication."),
      });
    } finally {
      setPreparing(false);
    }
  };

  const publish = async () => {
    if (!preflight) return;
    setPublishing(true);
    try {
      const result = await publishPageTemplate({
        pageId,
        draftHash: preflight.draftHash,
        confirmationToken:
          preflight.requiresDestructiveConfirmation
            ? preflight.confirmationToken ?? undefined
            : undefined,
      });
      setPreflight(null);
      await loadMetadata();
      notifications.show({
        message: t("Template version {{version}} published.", {
          version: result.revision.revision,
        }),
      });
    } catch (error: any) {
      if (error?.response?.data?.code === "page_template_draft_changed") {
        setPreflight(null);
        await waitForDraftSync(350);
        await preparePublish();
        return;
      }
      notifications.show({
        color: "red",
        message: error?.response?.data?.message ?? t("Could not publish template."),
      });
    } finally {
      setPublishing(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpened(true);
    setHistoryLoading(true);
    try {
      await loadMetadata();
    } catch {
      notifications.show({
        color: "red",
        message: t("Could not load template history."),
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const hasDestructiveRemoval =
    preflight?.requiresDestructiveConfirmation ?? false;

  const retryRun = async (runId: string) => {
    setRetryingRunId(runId);
    try {
      await retryPageTemplateSyncRun(pageId, runId);
      await loadMetadata();
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

  return (
    <>
      <Alert
        color={kind === "synced" ? "blue" : "gray"}
        variant="light"
        radius="md"
        icon={<IconTemplate size={22} />}
        title={
          <Group gap="xs">
            <Text fw={700}>{t("Template editor")}</Text>
            <Badge variant="light">
              {kind === "synced"
                ? t("Synchronized")
                : t("Regular")}
            </Badge>
            {kind === "synced" && <Badge color="orange">{t("Draft")}</Badge>}
            {kind === "synced" && revisions[0] && (
              <Badge variant="outline">
                {t("Published v{{version}}", {
                  version: revisions[0].revision,
                })}
              </Badge>
            )}
            {kind === "synced" && (
              <Badge variant="outline">
                {t("{{count}} linked pages", { count: usageCount })}
              </Badge>
            )}
          </Group>
        }
        mb="sm"
      >
        <Group justify="space-between" align="center" wrap="wrap">
          <Text size="sm" c="dimmed" maw={680}>
            {kind === "synced"
              ? t(
                  "Draft changes stay here until you publish. Template blocks update linked pages; fields keep each page's values.",
                )
              : t(
                  "New pages receive an independent copy. Later template changes do not affect them.",
                )}
          </Text>
          {kind === "synced" && (
            <Group gap="xs">
              <Button
                variant="subtle"
                leftSection={<IconHistory size={16} />}
                onClick={() => void openHistory()}
              >
                {t("History")}
              </Button>
              {editable && (
                <Button
                  leftSection={<IconSend size={16} />}
                  loading={preparing || !editor || unsyncedChanges > 0}
                  disabled={!editor || unsyncedChanges > 0}
                  onClick={() => void preparePublish()}
                >
                  {t("Review and publish")}
                </Button>
              )}
            </Group>
          )}
        </Group>
      </Alert>

      <Modal
        opened={Boolean(preflight)}
        onClose={() => setPreflight(null)}
        title={t("Publish template version {{version}}", {
          version: preflight?.nextRevision ?? "",
        })}
        centered
        size="lg"
      >
        {preflight && (
          <Stack>
            <Text size="sm" c="dimmed">
              {t("{{count}} linked pages will be updated after publication.", {
                count: preflight.activeInstanceCount,
              })}
            </Text>
            <Stack gap={4}>
              <Text fw={600}>{t("Changes")}</Text>
              <Text size="sm">
                {t("{{added}} blocks added, {{changed}} changed, {{removed}} removed.", {
                  added: preflight.diff.addedBlockIds.length,
                  changed: preflight.diff.changedBlockIds.length,
                  removed: preflight.diff.removedBlockIds.length,
                })}
              </Text>
              <Text size="sm">
                {t("{{added}} fields added, {{removed}} removed, {{renamed}} renamed.", {
                  added: preflight.diff.addedFields.length,
                  removed: preflight.diff.removedFields.length,
                  renamed: preflight.diff.renamedFields.length,
                })}
              </Text>
            </Stack>
            {hasDestructiveRemoval && (
              <Alert
                color="red"
                icon={<IconAlertTriangle size={18} />}
                title={
                  preflight.filledRemovedFieldInstanceCount > 0
                    ? t("Filled fields will be deleted")
                    : t("Fields will be removed from linked pages")
                }
              >
                <Stack gap="sm">
                  <Text size="sm">
                    {preflight.filledRemovedFieldInstanceCount > 0
                      ? t(
                          "Values on {{count}} linked pages will be permanently deleted. This cannot be undone.",
                          { count: preflight.filledRemovedFieldInstanceCount },
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
                      preflight.filledRemovedFieldInstanceCount > 0
                        ? t("I understand that these field values will be deleted")
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
        onClose={() => setHistoryOpened(false)}
        title={t("Template history")}
        centered
        size="lg"
      >
        {historyLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
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
                          {new Date(revision.createdAt).toLocaleString()}
                        </Text>
                      </div>
                      <Group gap="xs">
                        {run && <Badge variant="light">{run.status}</Badge>}
                        {run && ["partial", "failed"].includes(run.status) && (
                          <Button
                            size="xs"
                            variant="light"
                            loading={retryingRunId === run.id}
                            onClick={() => void retryRun(run.id)}
                          >
                            {t("Retry failed pages")}
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => {
                            const index = revisions.findIndex(
                              (candidate) => candidate.id === revision.id,
                            );
                            setPreviewRevision(revision);
                            setCompareRevision(revisions[index + 1] ?? null);
                          }}
                        >
                          {t("View and compare")}
                        </Button>
                      </Group>
                    </Group>
                  );
                })
              )}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Modal>

      <Modal
        opened={Boolean(previewRevision)}
        onClose={() => {
          setPreviewRevision(null);
          setCompareRevision(null);
        }}
        title={t("Version {{version}}", {
          version: previewRevision?.revision ?? "",
        })}
        size="xl"
      >
        {previewRevision && (
          <Stack>
            {comparison && compareRevision && (
              <Paper withBorder p="sm" radius="md">
                <Text fw={600} size="sm">
                  {t("Compared with version {{version}}", {
                    version: compareRevision.revision,
                  })}
                </Text>
                <Text size="sm" c="dimmed">
                  {t("{{added}} blocks added, {{changed}} changed, {{removed}} removed.", {
                    added: comparison.addedBlockIds.length,
                    changed: comparison.changedBlockIds.length,
                    removed: comparison.removedBlockIds.length,
                  })}
                </Text>
              </Paper>
            )}
            <SimpleGrid cols={{ base: 1, md: compareRevision ? 2 : 1 }}>
              {compareRevision && (
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    {t("Version {{version}}", {
                      version: compareRevision.revision,
                    })}
                  </Text>
                  <TemplateRevisionPreview content={compareRevision.content} />
                </Stack>
              )}
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  {t("Version {{version}}", {
                    version: previewRevision.revision,
                  })}
                </Text>
                <TemplateRevisionPreview content={previewRevision.content} />
              </Stack>
            </SimpleGrid>
          </Stack>
        )}
      </Modal>
    </>
  );
}

function waitForDraftSync(delay: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}
