import {
  Modal,
  Button,
  SimpleGrid,
  FileButton,
  Group,
  Alert,
  Paper,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import {
  IconBrandNotion,
  IconCheck,
  IconFileCode,
  IconFileTypeZip,
  IconMarkdown,
  IconX,
} from "@tabler/icons-react";
import {
  importPage,
  importZip,
  previewDocmostZip,
  confirmDocmostImport,
  cancelDocmostImport,
} from "@/features/page/services/page-service.ts";
import { notifications } from "@mantine/notifications";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { useAtom } from "jotai";
import { buildTree } from "@/features/page/tree/utils";
import { IPage } from "@/features/page/types/page.types.ts";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFileImportSizeLimit } from "@/lib/config.ts";
import { formatBytes } from "@/lib";
import { getFileTaskById } from "@/features/file-task/services/file-task-service.ts";
import { getRecentDocmostImportReports } from "@/features/file-task/services/file-task-service.ts";
import type { IFileTask } from "@/features/file-task/types/file-task.types.ts";
import {
  clearPendingDocmostImport,
  loadPendingDocmostImport,
  storePendingDocmostImport,
} from "@/features/file-task/utils/pending-docmost-import.ts";
import { queryClient } from "@/lib/query-client.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import type {
  DocmostImportOptions,
  ImportPreview,
  ImportReport,
} from "@docmost/api-contract";

interface PageImportModalProps {
  spaceId: string;
  open: boolean;
  onClose: () => void;
}

function ImportReportSummary({ report }: { report: ImportReport }) {
  const { t } = useTranslation();

  return (
    <Stack gap={0}>
      <Text size="sm">
        {t(
          "Created {{pages}} pages, {{databases}} databases, {{rows}} rows, {{attachments}} attachments and {{labels}} labels.",
          {
            ...report.created,
          },
        )}
      </Text>
      <Text size="sm">
        {t(
          "Dictionary: {{created}} created, {{updated}} updated, {{skipped}} skipped. Cleared references: {{users}} user, {{pages}} page. Warnings: {{warnings}}.",
          {
            created: report.created.dictionaryTerms,
            updated: report.updated.dictionaryTerms,
            skipped: report.skipped.dictionaryTerms,
            users: report.skipped.userReferences,
            pages: report.skipped.pageReferences,
            warnings: report.warnings.length,
          },
        )}
      </Text>
      {report.warnings.length > 0 && (
        <Text size="xs" c="orange">
          {report.warnings.join(" ")}
        </Text>
      )}
    </Stack>
  );
}

export default function PageImportModal({
  spaceId,
  open,
  onClose,
}: PageImportModalProps) {
  const { t } = useTranslation();
  const pendingDocmostTaskIdRef = useRef<string | null>(null);
  const handleClose = () => {
    const pendingTaskId = pendingDocmostTaskIdRef.current;
    pendingDocmostTaskIdRef.current = null;
    if (pendingTaskId) {
      void cancelDocmostImport(pendingTaskId).catch((error) => {
        console.error("Failed to cancel pending Docmost import", error);
      });
    }
    onClose();
  };

  return (
    <>
      <Modal.Root
        opened={open}
        onClose={handleClose}
        size={600}
        padding="xl"
        yOffset="10vh"
        xOffset={0}
        mah="80vh"
        keepMounted={true}
      >
        <Modal.Overlay />
        <Modal.Content style={{ overflow: "hidden" }}>
          <Modal.Header py={0}>
            <Modal.Title fw={500}>{t("Import pages")}</Modal.Title>
            <Modal.CloseButton aria-label={t("Close")} />
          </Modal.Header>
          <Modal.Body style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <ImportFormatSelection
              spaceId={spaceId}
              open={open}
              onClose={handleClose}
              onPendingDocmostTaskChange={(fileTaskId) => {
                pendingDocmostTaskIdRef.current = fileTaskId;
              }}
            />
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}

interface ImportFormatSelection {
  spaceId: string;
  open: boolean;
  onClose: () => void;
  onPendingDocmostTaskChange: (fileTaskId: string | null) => void;
}
function ImportFormatSelection({
  spaceId,
  open,
  onClose,
  onPendingDocmostTaskChange,
}: ImportFormatSelection) {
  const { t } = useTranslation();
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const [fileTaskId, setFileTaskId] = useState<string | null>(null);
  const emit = useQueryEmit();

  const markdownFileRef = useRef<() => void>(null);
  const htmlFileRef = useRef<() => void>(null);
  const notionFileRef = useRef<() => void>(null);
  const zipFileRef = useRef<() => void>(null);
  const docmostFileRef = useRef<() => void>(null);
  const [docmostPreview, setDocmostPreview] = useState<ImportPreview | null>(
    null,
  );
  const [docmostOptions, setDocmostOptions] = useState<DocmostImportOptions>({
    applyDocumentFields: true,
    applyDictionary: true,
    applyHeadingNumbering: true,
    applyTags: true,
    cleanupLegacyHeadingNumbers: true,
  });
  const [isInspecting, setIsInspecting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [recentDocmostImports, setRecentDocmostImports] = useState<IFileTask[]>(
    [],
  );

  useEffect(() => {
    if (!open) return;
    void getRecentDocmostImportReports(spaceId)
      .then(setRecentDocmostImports)
      .catch((error) => {
        console.error("Failed to load recent Docmost imports", error);
      });
  }, [open, spaceId]);

  useEffect(() => {
    const pendingTaskId = loadPendingDocmostImport(spaceId);
    if (!pendingTaskId) return;

    setFileTaskId(pendingTaskId);
    notifications.show({
      id: "import",
      title: t("Importing Docmost archive"),
      message: t("The archive is being restored. You can safely return later."),
      loading: true,
      withCloseButton: true,
      autoClose: false,
    });
  }, [spaceId, t]);

  const handleDocmostUpload = async (selectedFile: File | null) => {
    if (!selectedFile) return;
    setIsInspecting(true);
    try {
      const preview = await previewDocmostZip(selectedFile, spaceId);
      onPendingDocmostTaskChange(preview.fileTaskId);
      setDocmostPreview(preview);
      setDocmostOptions({
        applyDocumentFields: preview.availableSettings.documentFields,
        applyDictionary: preview.availableSettings.dictionary,
        applyHeadingNumbering: preview.availableSettings.headingNumbering,
        applyTags: preview.availableSettings.tags,
        cleanupLegacyHeadingNumbers: true,
      });
    } catch (err: any) {
      notifications.show({
        color: "red",
        title: t("Import preview failed"),
        message: err?.response?.data?.message ?? t("Invalid Docmost archive"),
      });
      docmostFileRef.current?.();
    } finally {
      setIsInspecting(false);
    }
  };

  const handleConfirmDocmostImport = async () => {
    if (!docmostPreview) return;
    setIsConfirming(true);
    try {
      const task = await confirmDocmostImport(
        docmostPreview.fileTaskId,
        docmostOptions,
      );
      onPendingDocmostTaskChange(null);
      storePendingDocmostImport(spaceId, task.id);
      setFileTaskId(task.id);
      setDocmostPreview(null);
      docmostFileRef.current?.();
      onClose();
      notifications.show({
        id: "import",
        title: t("Importing Docmost archive"),
        message: t(
          "The archive is being restored. You can safely return later.",
        ),
        loading: true,
        withCloseButton: true,
        autoClose: false,
      });
    } catch (err: any) {
      notifications.show({
        color: "red",
        title: t("Import failed"),
        message: err?.response?.data?.message ?? t("Unable to start import"),
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelDocmostImport = async () => {
    if (docmostPreview) {
      onPendingDocmostTaskChange(null);
      try {
        await cancelDocmostImport(docmostPreview.fileTaskId);
      } catch (err) {
        console.error("Failed to cancel Docmost import", err);
      }
    }
    setDocmostPreview(null);
    docmostFileRef.current?.();
  };

  const handleZipUpload = async (selectedFile: File, source: string) => {
    if (!selectedFile) {
      return;
    }

    try {
      onClose();

      notifications.show({
        id: "import",
        title: t("Uploading import file"),
        message: t("Please don't close this tab."),
        loading: true,
        withCloseButton: false,
        autoClose: false,
      });

      const importTask = await importZip(selectedFile, spaceId, source);
      notifications.update({
        id: "import",
        title: t("Importing pages"),
        message: t(
          "Page import is in progress. You can check back later if this takes longer.",
        ),
        loading: true,
        withCloseButton: true,
        autoClose: false,
      });

      setFileTaskId(importTask.id);

      // Reset file input after successful upload
      if (source === "notion" && notionFileRef.current) {
        notionFileRef.current();
      } else if (source === "generic" && zipFileRef.current) {
        zipFileRef.current();
      }
    } catch (err) {
      console.log("Failed to upload import file", err);
      notifications.update({
        id: "import",
        color: "red",
        title: t("Failed to upload import file"),
        message: err?.response.data.message,
        icon: <IconX size={18} />,
        loading: false,
        withCloseButton: true,
        autoClose: false,
      });
    }
  };

  useEffect(() => {
    if (!fileTaskId) return;

    let requestInFlight = false;
    let terminal = false;
    const poll = async () => {
      if (requestInFlight || terminal) return;
      requestInFlight = true;
      try {
        const fileTask = await getFileTaskById(fileTaskId);
        const status = fileTask.status;

        if (status === "success") {
          terminal = true;
          clearPendingDocmostImport(spaceId);
          const report = fileTask.result?.report;
          notifications.update({
            id: "import",
            color: "teal",
            title: t("Import complete"),
            message: report ? (
              <ImportReportSummary report={report} />
            ) : (
              t("Your pages were successfully imported.")
            ),
            icon: <IconCheck size={18} />,
            loading: false,
            withCloseButton: true,
            autoClose: false,
          });
          setFileTaskId(null);
          if (fileTask.source === "docmost") {
            setRecentDocmostImports((current) => [
              fileTask,
              ...current.filter((item) => item.id !== fileTask.id),
            ]);
          }

          await queryClient.refetchQueries({
            queryKey: ["root-sidebar-pages", fileTask.spaceId],
          });

          await queryClient.invalidateQueries({
            queryKey: ["recent-changes", fileTask.spaceId],
          });

          setTimeout(() => {
            emit({
              operation: "refetchRootTreeNodeEvent",
              spaceId: spaceId,
            });
          }, 50);
        }

        if (status === "failed") {
          terminal = true;
          clearPendingDocmostImport(spaceId);
          notifications.update({
            id: "import",
            color: "red",
            title: t("Page import failed"),
            message: t(
              "Something went wrong while importing pages: {{reason}}.",
              {
                reason: fileTask.errorMessage,
              },
            ),
            icon: <IconX size={18} />,
            loading: false,
            withCloseButton: true,
            autoClose: false,
          });
          setFileTaskId(null);
          console.error(fileTask.errorMessage);
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 403 || status === 404) {
          terminal = true;
          clearPendingDocmostImport(spaceId);
          notifications.update({
            id: "import",
            color: "red",
            title: t("Import failed"),
            message: err?.response?.data?.message ?? t("Import failed"),
            icon: <IconX size={18} />,
            loading: false,
            withCloseButton: true,
            autoClose: false,
          });
          setFileTaskId(null);
        } else {
          console.warn("Unable to load import status; retrying", err);
        }
      } finally {
        requestInFlight = false;
      }
    };

    void poll();
    const intervalId = setInterval(() => void poll(), 3000);
    return () => clearInterval(intervalId);
  }, [emit, fileTaskId, spaceId, t]);

  const handleFileUpload = async (selectedFiles: File[]) => {
    if (!selectedFiles) {
      return;
    }

    onClose();

    const alert = notifications.show({
      title: t("Importing pages"),
      message: t("Page import is in progress. Please do not close this tab."),
      loading: true,
      autoClose: false,
    });

    const pages: IPage[] = [];
    let pageCount = 0;

    for (const file of selectedFiles) {
      try {
        const page = await importPage(file, spaceId);
        pages.push(page);
        pageCount += 1;
      } catch (err) {
        console.log("Failed to import page", err);
      }
    }

    if (pages?.length > 0 && pageCount > 0) {
      const newTreeNodes = buildTree(pages);
      const fullTree = treeData.concat(newTreeNodes);

      if (newTreeNodes?.length && fullTree?.length > 0) {
        setTreeData(fullTree);
      }

      // Reset file inputs after successful upload
      if (markdownFileRef.current) markdownFileRef.current();
      if (htmlFileRef.current) htmlFileRef.current();

      const pageCountText =
        pageCount === 1 ? `1 ${t("page")}` : `${pageCount} ${t("pages")}`;

      notifications.update({
        id: alert,
        color: "teal",
        title: `${t("Successfully imported")} ${pageCountText}`,
        message: t("Your import is complete."),
        icon: <IconCheck size={18} />,
        loading: false,
        autoClose: 5000,
      });
    } else {
      notifications.update({
        id: alert,
        color: "red",
        title: t("Failed to import pages"),
        message: t("Unable to import pages. Please try again."),
        icon: <IconX size={18} />,
        loading: false,
        autoClose: 5000,
      });
    }
  };

  // @ts-ignore
  return (
    <>
      {docmostPreview ? (
        <Stack gap="md">
          <Paper withBorder p="md">
            <Text fw={600}>{docmostPreview.displayName}</Text>
            <Text size="sm" c="dimmed">
              {t(
                "{{pages}} pages, {{databases}} databases, {{rows}} rows, {{attachments}} attachments",
                docmostPreview.counts,
              )}
            </Text>
            <Text size="sm" c="dimmed">
              {t("{{terms}} dictionary terms and {{labels}} labels", {
                terms: docmostPreview.counts.dictionaryTerms,
                labels: docmostPreview.counts.labels,
              })}
            </Text>
          </Paper>

          <Text fw={500}>{t("Space settings")}</Text>
          <Switch
            label={t("Document fields")}
            checked={docmostOptions.applyDocumentFields}
            disabled={!docmostPreview.availableSettings.documentFields}
            onChange={(event) =>
              setDocmostOptions((current) => ({
                ...current,
                applyDocumentFields: event.currentTarget.checked,
              }))
            }
          />
          <Switch
            label={t("Heading numbering")}
            checked={docmostOptions.applyHeadingNumbering}
            disabled={!docmostPreview.availableSettings.headingNumbering}
            onChange={(event) =>
              setDocmostOptions((current) => ({
                ...current,
                applyHeadingNumbering: event.currentTarget.checked,
              }))
            }
          />
          <Switch
            label={t("Dictionary settings and terms")}
            checked={docmostOptions.applyDictionary}
            disabled={!docmostPreview.availableSettings.dictionary}
            onChange={(event) =>
              setDocmostOptions((current) => ({
                ...current,
                applyDictionary: event.currentTarget.checked,
              }))
            }
          />
          <Switch
            label={t("Tags")}
            checked={docmostOptions.applyTags}
            disabled={!docmostPreview.availableSettings.tags}
            onChange={(event) =>
              setDocmostOptions((current) => ({
                ...current,
                applyTags: event.currentTarget.checked,
              }))
            }
          />

          {docmostPreview.warnings.length > 0 && (
            <Alert color="yellow" title={t("Import warnings")}>
              {docmostPreview.warnings.join(" ")}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={handleCancelDocmostImport}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleConfirmDocmostImport} loading={isConfirming}>
              {t("Import archive")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <>
          <Paper withBorder p="md" mb="md">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text fw={600}>{t("Docmost archive")}</Text>
                <Text size="sm" c="dimmed">
                  {t(
                    "Restore pages, databases, diagrams, attachments and portable space settings.",
                  )}
                </Text>
              </div>
              <FileButton
                onChange={handleDocmostUpload}
                accept="application/zip,.zip"
                resetRef={docmostFileRef}
              >
                {(props) => (
                  <Button
                    {...props}
                    loading={isInspecting}
                    style={{ flexShrink: 0 }}
                  >
                    {t("Choose archive")}
                  </Button>
                )}
              </FileButton>
            </Group>
          </Paper>
          {recentDocmostImports.some((task) => task.result?.report) && (
            <Stack gap="xs" mb="md">
              <Text fw={500}>{t("Recent Docmost imports")}</Text>
              {recentDocmostImports
                .filter((task) => task.result?.report)
                .map((task) => {
                  const report = task.result!.report!;
                  return (
                    <Paper key={task.id} withBorder p="sm">
                      <Text size="sm" fw={500}>
                        {task.fileName}
                      </Text>
                      <ImportReportSummary report={report} />
                    </Paper>
                  );
                })}
            </Stack>
          )}
          <SimpleGrid cols={2}>
            <FileButton
              onChange={handleFileUpload}
              accept=".md"
              multiple
              resetRef={markdownFileRef}
            >
              {(props) => (
                <Button
                  justify="start"
                  variant="default"
                  leftSection={<IconMarkdown size={18} />}
                  {...props}
                >
                  {t("Markdown")}
                </Button>
              )}
            </FileButton>

            <FileButton
              onChange={handleFileUpload}
              accept="text/html"
              multiple
              resetRef={htmlFileRef}
            >
              {(props) => (
                <Button
                  justify="start"
                  variant="default"
                  leftSection={<IconFileCode size={18} />}
                  {...props}
                >
                  {t("HTML")}
                </Button>
              )}
            </FileButton>

            <FileButton
              onChange={(file) => handleZipUpload(file, "notion")}
              accept="application/zip"
              resetRef={notionFileRef}
            >
              {(props) => (
                <Button
                  justify="start"
                  variant="default"
                  leftSection={<IconBrandNotion size={18} />}
                  {...props}
                >
                  {t("Notion")}
                </Button>
              )}
            </FileButton>
          </SimpleGrid>

          <Group justify="center" gap="xl" mih={150}>
            <div>
              <Text ta="center" size="lg" inline>
                {t("Import zip file")}
              </Text>
              <Text ta="center" size="sm" c="dimmed" inline py="sm">
                {t(
                  "Upload zip file containing Markdown and HTML files. Max: {{sizeLimit}}",
                  {
                    sizeLimit: formatBytes(getFileImportSizeLimit()),
                  },
                )}
              </Text>
              <FileButton
                onChange={(file) => handleZipUpload(file, "generic")}
                accept="application/zip"
                resetRef={zipFileRef}
              >
                {(props) => (
                  <Group justify="center">
                    <Button
                      justify="center"
                      leftSection={<IconFileTypeZip size={18} />}
                      {...props}
                    >
                      {t("Upload file")}
                    </Button>
                  </Group>
                )}
              </FileButton>
            </div>
          </Group>
        </>
      )}
    </>
  );
}
