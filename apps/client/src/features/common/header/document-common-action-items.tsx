import { Group, Menu } from '@mantine/core';
import {
  IconArrowsHorizontal,
  IconFileExport,
  IconHistory,
  IconLink,
  IconMarkdown,
  IconPrinter,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { PageWidthToggle } from '@/features/user/components/page-width-pref.tsx';

interface DocumentCommonActionItemsProps {
  onCopyLink: () => void;
  onCopyAsMarkdown?: () => void;
  onOpenHistory?: () => void;
  onOpenExport?: () => void;
  onPrint?: () => void;
  disableExport?: boolean;
}

export function DocumentCommonActionItems({
  onCopyLink,
  onCopyAsMarkdown,
  onOpenHistory,
  onOpenExport,
  onPrint,
  disableExport,
}: DocumentCommonActionItemsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Menu.Item leftSection={<IconLink size={16} />} onClick={onCopyLink}>
        {t('Copy link')}
      </Menu.Item>

      {onCopyAsMarkdown && (
        <Menu.Item leftSection={<IconMarkdown size={16} />} onClick={onCopyAsMarkdown}>
          {t('Copy as Markdown')}
        </Menu.Item>
      )}

      <Menu.Divider />

      <Menu.Item leftSection={<IconArrowsHorizontal size={16} />}>
        <Group wrap="nowrap">
          <PageWidthToggle label={t('Full width')} />
        </Group>
      </Menu.Item>

      {onOpenHistory && (
        <Menu.Item leftSection={<IconHistory size={16} />} onClick={onOpenHistory}>
          {t('Page history')}
        </Menu.Item>
      )}

      <Menu.Divider />

      {onOpenExport && (
        <Menu.Item
          leftSection={<IconFileExport size={16} />}
          onClick={onOpenExport}
          disabled={disableExport}
        >
          {t('Export')}
        </Menu.Item>
      )}

      {onPrint && (
        <Menu.Item leftSection={<IconPrinter size={16} />} onClick={onPrint}>
          {t('Print PDF')}
        </Menu.Item>
      )}
    </>
  );
}
