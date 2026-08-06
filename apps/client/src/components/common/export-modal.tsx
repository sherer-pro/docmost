import {
  Modal,
  Button,
  Group,
  Text,
  Select,
  Switch,
  Divider,
} from "@mantine/core";
import { exportPage } from "@/features/page/services/page-service.ts";
import { useState } from "react";
import { ExportFormat } from "@/features/page/types/page.types.ts";
import { notifications } from "@mantine/notifications";
import { exportSpace } from "@/features/space/services/space-service";
import { useTranslation } from "react-i18next";
import { exportDatabase as exportDatabaseFile } from "@/features/database/services/database-service";
import { DatabaseExportFormat } from "@/features/database/types/database.types";
import {
  getExportFormatValues,
  isSpaceExportFormat,
  shouldShowAttachments,
  shouldShowIncludeChildren,
} from "@/components/common/export-modal.utils";

interface ExportModalProps {
  id: string;
  type: "space" | "page" | "database";
  open: boolean;
  onClose: () => void;
  onExportDatabase?: (
    format: DatabaseExportFormat,
    options?: { includeChildren?: boolean; includeAttachments?: boolean },
  ) => Promise<void>;
}

export default function ExportModal({
  id,
  type,
  open,
  onClose,
  onExportDatabase,
}: ExportModalProps) {
  const [format, setFormat] = useState<string>(ExportFormat.Docmost);
  const [includeChildren, setIncludeChildren] = useState<boolean>(false);
  const [includeAttachments, setIncludeAttachments] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const { t } = useTranslation();

  const showIncludeChildren = shouldShowIncludeChildren(type, format);
  const showAttachments = shouldShowAttachments(type, format);

  const formatOptions = getExportFormatValues(type).map((value) => ({
    value,
    label:
      value === ExportFormat.Docmost
        ? t("export.format.docmost")
        : value === ExportFormat.Markdown
          ? t("export.format.markdown")
          : value === ExportFormat.HTML
            ? t("export.format.html")
            : t("Print PDF"),
  }));

  const modalTitle =
    type === "database" ? t("Export database") : t(`Export ${type}`);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (type === "page") {
        await exportPage({
          pageId: id,
          format: format as ExportFormat,
          includeChildren,
          includeAttachments:
            format === ExportFormat.Docmost ? true : includeAttachments,
        });
      }

      if (type === "space") {
        if (!isSpaceExportFormat(format)) {
          throw new Error("Unsupported space export format");
        }

        await exportSpace({
          spaceId: id,
          format,
          includeAttachments:
            format === ExportFormat.Docmost ? true : includeAttachments,
        });
      }

      if (type === "database") {
        if (onExportDatabase) {
          await onExportDatabase(format as DatabaseExportFormat, {
            includeChildren:
              format === ExportFormat.Docmost ? true : includeChildren,
            includeAttachments:
              format === ExportFormat.Docmost ? true : includeAttachments,
          });
        } else {
          await exportDatabaseFile(id, {
            format: format as DatabaseExportFormat,
            includeChildren:
              format === ExportFormat.Docmost ? true : includeChildren,
            includeAttachments:
              format === ExportFormat.Docmost ? true : includeAttachments,
          });
        }
      }

      notifications.show({
        message: t("Export successful"),
      });
      onClose();
    } catch (err: any) {
      notifications.show({
        message: `Export failed: ${err?.response?.data?.message ?? ""}`,
        color: "red",
      });
      console.error("export error", err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleChange = (value: string | null) => {
    if (!value) {
      return;
    }

    setFormat(value);
  };

  return (
    <Modal.Root
      opened={open}
      onClose={onClose}
      size={500}
      padding="xl"
      yOffset="10vh"
      xOffset={0}
      mah={400}
      onClick={(e) => e.stopPropagation()}
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Header py={0}>
          <Modal.Title fw={500}>{modalTitle}</Modal.Title>
          <Modal.CloseButton aria-label={t("Close")} />
        </Modal.Header>
        <Modal.Body>
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="md">{t("Format")}</Text>
            </div>
            <ExportFormatSelection
              format={format}
              onChange={handleChange}
              options={formatOptions}
            />
          </Group>

          {type === "database" && (
            <Text size="sm" c="dimmed" mt="sm">
              {format === ExportFormat.Docmost
                ? t(
                    "Docmost archive exports the full database and all saved views.",
                  )
                : t(
                    "The current filters, sorting and visible columns will be exported.",
                  )}
            </Text>
          )}

          {showIncludeChildren && (
            <>
              <Divider my="sm" />

              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="md">{t("Include subpages")}</Text>
                </div>
                <Switch
                  onChange={(event) =>
                    setIncludeChildren(event.currentTarget.checked)
                  }
                  checked={includeChildren}
                  aria-label={t("Include subpages")}
                />
              </Group>

              {showAttachments && (
                <Group justify="space-between" wrap="nowrap" mt="md">
                  <div>
                    <Text size="md">{t("Include attachments")}</Text>
                  </div>
                  <Switch
                    onChange={(event) =>
                      setIncludeAttachments(event.currentTarget.checked)
                    }
                    checked={includeAttachments}
                    aria-label={t("Include attachments")}
                  />
                </Group>
              )}
            </>
          )}

          {showAttachments && !showIncludeChildren && (
            <>
              <Divider my="sm" />

              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="md">{t("Include attachments")}</Text>
                </div>
                <Switch
                  onChange={(event) =>
                    setIncludeAttachments(event.currentTarget.checked)
                  }
                  checked={includeAttachments}
                  aria-label={t("Include attachments")}
                />
              </Group>
            </>
          )}

          <Group justify="center" mt="md">
            <Button onClick={onClose} variant="default">
              {t("Cancel")}
            </Button>
            <Button onClick={handleExport} loading={isExporting}>
              {t("Export")}
            </Button>
          </Group>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

interface ExportFormatSelectionProps {
  format: string;
  onChange: (value: string | null) => void;
  options: Array<{ value: string; label: string }>;
}

function ExportFormatSelection({
  format,
  onChange,
  options,
}: ExportFormatSelectionProps) {
  const { t } = useTranslation();

  return (
    <Select
      data={options}
      value={format}
      onChange={onChange}
      styles={{ wrapper: { maxWidth: 180 } }}
      comboboxProps={{ width: "180" }}
      allowDeselect={false}
      withCheckIcon={false}
      aria-label={t("Select export format")}
    />
  );
}
