import { ActionIcon, Menu } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import ExportModal from '@/components/common/export-modal';
import { DocumentCommonActionItems } from '@/features/common/header/document-common-action-items.tsx';
import { historyAtoms } from '@/features/page-history/atoms/history-atoms.ts';
import { PageStateSegmentedControl } from '@/features/user/components/page-state-pref.tsx';
import { useClipboard } from '@/hooks/use-clipboard';
import { getAppUrl } from '@/lib/config.ts';
import { exportDatabase, getDatabaseMarkdown } from '@/features/database/services/database-service';
import { DatabaseExportFormat } from '@/features/database/types/database.types';

interface DatabaseHeaderMenuProps {
  databaseId: string;
  databasePageId?: string;
  spaceSlug: string;
  readOnly?: boolean;
}

export default function DatabaseHeaderMenu({
  databaseId,
  databasePageId,
  spaceSlug,
  readOnly,
}: DatabaseHeaderMenuProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: 500 });
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);

  const handleCopyLink = () => {
    const databaseUrl = `${getAppUrl()}/s/${spaceSlug}/databases/${databaseId}`;
    clipboard.copy(databaseUrl);
    notifications.show({ message: t('Link copied') });
  };

  const handleCopyAsMarkdown = async () => {
    try {
      const { markdown } = await getDatabaseMarkdown(databaseId);
      clipboard.copy(markdown);
      notifications.show({ message: t('Copied') });
    } catch {
      notifications.show({
        message: t('Export failed'),
        color: 'red',
      });
    }
  };

  const handlePrint = async () => {
    try {
      await exportDatabase(databaseId, {
        format: DatabaseExportFormat.PDF,
      });

      notifications.show({ message: t('Export successful') });
    } catch {
      notifications.show({
        message: t('Export failed'),
        color: 'red',
      });
    }
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  return (
    <>
      {!readOnly && <PageStateSegmentedControl size="xs" />}

      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={230}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <ActionIcon variant="subtle" color="dark" aria-label={t('Open menu')}>
            <IconDots size={20} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <DocumentCommonActionItems
            onCopyLink={handleCopyLink}
            onCopyAsMarkdown={handleCopyAsMarkdown}
            onOpenHistory={databasePageId ? openHistoryModal : undefined}
            onOpenExport={openExportModal}
            onPrint={handlePrint}
          />
        </Menu.Dropdown>
      </Menu>

      <ExportModal
        type="database"
        id={databaseId}
        open={exportOpened}
        onClose={closeExportModal}
      />
    </>
  );
}
