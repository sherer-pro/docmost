import { ActionIcon, Menu } from '@mantine/core';
import { IconArrowRight, IconDots, IconLink, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import ExportModal from '@/components/common/export-modal';
import { DocumentCommonActionItems } from '@/features/common/header/document-common-action-items.tsx';
import { exportDatabase, getDatabaseMarkdown } from '@/features/database/services/database-service';
import { DatabaseExportFormat } from '@/features/database/types/database.types';
import { historyAtoms } from '@/features/page-history/atoms/history-atoms.ts';
import MovePageModal from '@/features/page/components/move-page-modal.tsx';
import { useDeletePageModal } from '@/features/page/hooks/use-delete-page-modal.tsx';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import { usePageQuery, useRemovePageMutation } from '@/features/page/queries/page-query.ts';
import ShareModal from '@/features/share/components/share-modal.tsx';
import { PageStateSegmentedControl } from '@/features/user/components/page-state-pref.tsx';
import { useClipboard } from '@/hooks/use-clipboard';
import { getAppUrl } from '@/lib/config.ts';

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
  const { data: page } = usePageQuery({ pageId: databasePageId });
  const { openDeleteModal } = useDeletePageModal();
  const { mutateAsync: removePageMutationAsync } = useRemovePageMutation();
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [movePageModalOpened, { open: openMovePageModal, close: closeMovePageModal }] =
    useDisclosure(false);

  /**
   * Для базы всегда оставляем прямую ссылку на database-route.
   * Этот пункт используется как fallback, даже когда доступна связанная страница.
   */
  const handleCopyDatabaseLink = () => {
    const databaseUrl = `${getAppUrl()}/s/${spaceSlug}/databases/${databaseId}`;
    clipboard.copy(databaseUrl);
    notifications.show({ message: t('Link copied') });
  };

  /**
   * Если у базы есть связанная page, копируем canonical page URL через buildPageUrl.
   * Иначе (database root без page) откатываемся к database-route.
   */
  const handleCopyLink = () => {
    if (page?.slugId) {
      const pageUrl = `${getAppUrl()}${buildPageUrl(spaceSlug, page.slugId, page.title)}`;
      clipboard.copy(pageUrl);
      notifications.show({ message: t('Link copied') });
      return;
    }

    handleCopyDatabaseLink();
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

  const handleDeletePage = () => {
    if (!databasePageId) {
      return;
    }

    openDeleteModal({
      onConfirm: () => {
        void removePageMutationAsync(databasePageId);
      },
    });
  };

  const hasDatabasePage = Boolean(databasePageId && page?.slugId);

  return (
    <>
      {!readOnly && <PageStateSegmentedControl size="xs" />}

      {!readOnly && hasDatabasePage && <ShareModal pageId={databasePageId} readOnly={Boolean(readOnly)} />}

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
            onOpenHistory={hasDatabasePage ? openHistoryModal : undefined}
            onOpenExport={openExportModal}
            onPrint={handlePrint}
          />

          {hasDatabasePage && (
            <Menu.Item leftSection={<IconLink size={16} />} onClick={handleCopyDatabaseLink}>
              {t('Copy database link')}
            </Menu.Item>
          )}

          {/**
           * Для database root page (когда pageId отсутствует) операции page-domain
           * (share / history / move / trash) недоступны и намеренно скрыты.
           */}
          {!readOnly && hasDatabasePage && (
            <>
              <Menu.Divider />
              <Menu.Item leftSection={<IconArrowRight size={16} />} onClick={openMovePageModal}>
                {t('Move')}
              </Menu.Item>
            </>
          )}

          {!readOnly && hasDatabasePage && (
            <>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={handleDeletePage}>
                {t('Move to trash')}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

      <ExportModal
        type="database"
        id={databaseId}
        open={exportOpened}
        onClose={closeExportModal}
      />

      {hasDatabasePage && (
        <MovePageModal
          pageId={databasePageId}
          slugId={page.slugId}
          currentSpaceSlug={spaceSlug}
          onClose={closeMovePageModal}
          open={movePageModalOpened}
        />
      )}
    </>
  );
}
