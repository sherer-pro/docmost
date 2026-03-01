import { Modal, Button, Group, Text, Select, Switch, Divider } from '@mantine/core';
import { exportPage } from '@/features/page/services/page-service.ts';
import { useState } from 'react';
import { ExportFormat } from '@/features/page/types/page.types.ts';
import { notifications } from '@mantine/notifications';
import { exportSpace } from '@/features/space/services/space-service';
import { useTranslation } from 'react-i18next';
import { exportDatabase as exportDatabaseFile } from '@/features/database/services/database-service';
import { DatabaseExportFormat } from '@/features/database/types/database.types';

interface ExportModalProps {
  id: string;
  type: 'space' | 'page' | 'database';
  open: boolean;
  onClose: () => void;
}

export default function ExportModal({
  id,
  type,
  open,
  onClose,
}: ExportModalProps) {
  const [format, setFormat] = useState<string>(ExportFormat.Markdown);
  const [includeChildren, setIncludeChildren] = useState<boolean>(false);
  const [includeAttachments, setIncludeAttachments] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const { t } = useTranslation();

  const showIncludeChildren = type === 'page';
  const showAttachments = type === 'page' || type === 'space';

  const formatOptions =
    type === 'database'
      ? [
          { value: 'markdown', label: t('export.format.markdown') },
          { value: 'pdf', label: t('Print PDF') },
        ]
      : [
          { value: 'markdown', label: t('export.format.markdown') },
          { value: 'html', label: t('export.format.html') },
        ];

  const modalTitle =
    type === 'database' ? `${t('Export')} ${t('Database')}` : t(`Export ${type}`);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (type === 'page') {
        await exportPage({
          pageId: id,
          format: format as ExportFormat,
          includeChildren,
          includeAttachments,
        });
      }

      if (type === 'space') {
        await exportSpace({
          spaceId: id,
          format: format as ExportFormat,
          includeAttachments,
        });
      }

      if (type === 'database') {
        await exportDatabaseFile(id, {
          format: format as DatabaseExportFormat,
        });
      }

      notifications.show({
        message: t('Export successful'),
      });
      onClose();
    } catch (err: any) {
      notifications.show({
        message: `Export failed: ${err?.response?.data?.message ?? ''}`,
        color: 'red',
      });
      console.error('export error', err);
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
      <Modal.Content style={{ overflow: 'hidden' }}>
        <Modal.Header py={0}>
          <Modal.Title fw={500}>{modalTitle}</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="md">{t('Format')}</Text>
            </div>
            <ExportFormatSelection
              format={format}
              onChange={handleChange}
              options={formatOptions}
            />
          </Group>

          {showIncludeChildren && (
            <>
              <Divider my="sm" />

              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="md">{t('Include subpages')}</Text>
                </div>
                <Switch
                  onChange={(event) =>
                    setIncludeChildren(event.currentTarget.checked)
                  }
                  checked={includeChildren}
                />
              </Group>

              <Group justify="space-between" wrap="nowrap" mt="md">
                <div>
                  <Text size="md">{t('Include attachments')}</Text>
                </div>
                <Switch
                  onChange={(event) =>
                    setIncludeAttachments(event.currentTarget.checked)
                  }
                  checked={includeAttachments}
                />
              </Group>
            </>
          )}

          {showAttachments && !showIncludeChildren && (
            <>
              <Divider my="sm" />

              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="md">{t('Include attachments')}</Text>
                </div>
                <Switch
                  onChange={(event) =>
                    setIncludeAttachments(event.currentTarget.checked)
                  }
                  checked={includeAttachments}
                />
              </Group>
            </>
          )}

          <Group justify="center" mt="md">
            <Button onClick={onClose} variant="default">
              {t('Cancel')}
            </Button>
            <Button onClick={handleExport} loading={isExporting}>
              {t('Export')}
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
      styles={{ wrapper: { maxWidth: 120 } }}
      comboboxProps={{ width: '120' }}
      allowDeselect={false}
      withCheckIcon={false}
      aria-label={t('Select export format')}
    />
  );
}
