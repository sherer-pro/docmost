import { ActionIcon, Menu, Text } from '@mantine/core';
import { IconArrowRight, IconArrowsExchange, IconDots, IconMessageCircle, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import { useDisclosure } from '@mantine/hooks';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { saveAs } from 'file-saver';
import ExportModal from '@/components/common/export-modal';
import { DocumentCommonActionItems } from '@/features/common/header/document-common-action-items.tsx';
import { exportDatabase } from '@/features/database/services/database-service';
import { DatabaseExportFormat } from '@/features/database/types/database.types';
import {
  useDatabasePropertiesQuery,
  useDatabaseRowsQuery,
} from '@/features/database/queries/database-table-query.ts';
import { useGetDatabaseQuery } from '@/features/database/queries/database-query.ts';
import { historyAtoms } from '@/features/page-history/atoms/history-atoms.ts';
import MovePageModal from '@/features/page/components/move-page-modal.tsx';
import { useDeletePageModal } from '@/features/page/hooks/use-delete-page-modal.tsx';
import { buildDatabaseUrl } from '@/features/page/page.utils.ts';
import { usePageQuery, useRemovePageMutation } from '@/features/page/queries/page-query.ts';
import { useConvertDatabaseToPageMutation } from '@/features/database/queries/database-query.ts';
import ShareModal from '@/features/share/components/share-modal.tsx';
import { PageStateSegmentedControl } from '@/features/user/components/page-state-pref.tsx';
import { useClipboard } from '@/hooks/use-clipboard';
import { userAtom } from '@/features/user/atoms/current-user-atom.ts';
import { getAppUrl } from '@/lib/config.ts';
import {
  databaseTableExportStateAtom,
  defaultDatabaseTableExportState,
} from '@/features/database/atoms/database-table-export-atom';
import { buildDatabaseMarkdownFromState } from '@/features/database/utils/database-markdown';
import { dropTreeNodeAtom } from '@/features/page/tree/atoms/tree-data-atom.ts';
import { asideStateAtom } from '@/components/layouts/global/hooks/atoms/sidebar-atom.ts';

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
  const navigate = useNavigate();
  const clipboard = useClipboard({ timeout: 500 });
  const [user] = useAtom(userAtom);
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const { data: databasePage } = usePageQuery({ pageId: databasePageId });
  const { data: database } = useGetDatabaseQuery(databaseId);
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const { data: rows = [] } = useDatabaseRowsQuery(databaseId);
  const tableExportStateByDatabase = useAtomValue(databaseTableExportStateAtom);
  const { openDeleteModal } = useDeletePageModal();
  const { mutateAsync: removePageMutationAsync } = useRemovePageMutation();
  const dropTreeNode = useSetAtom(dropTreeNodeAtom);
  const setAsideState = useSetAtom(asideStateAtom);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [movePageModalOpened, { open: openMovePageModal, close: closeMovePageModal }] =
    useDisclosure(false);
  const { mutateAsync: convertDatabaseToPageAsync, isPending: isConvertingDatabaseToPage } =
    useConvertDatabaseToPageMutation(databasePage?.spaceId, databaseId);

  /**
   * Collects markdown on the client in the exact state of the current table:
   * We take into account sorting, filters and visible columns from the UI.
   */
  const getCurrentTableMarkdown = () => {
    const tableExportState = tableExportStateByDatabase[databaseId] ?? defaultDatabaseTableExportState;

    return buildDatabaseMarkdownFromState({
      title: (database?.name || databasePage?.title || t('database.editor.untitled')).trim(),
      description: database?.description,
      properties,
      rows,
      state: tableExportState,
      untitledLabel: t('Untitled'),
    });
  };

  /**
   * Copies a canonical link to a database page in the format /s/:space/db/:slug.
   */
  const handleCopyDatabaseLink = () => {
    if (!databasePage?.slugId) {
      return;
    }

    const databasePath = buildDatabaseUrl(spaceSlug, databasePage.slugId, databasePage.title);

    clipboard.copy(`${getAppUrl()}${databasePath}`);
    notifications.show({ message: t('Link copied') });
  };

  const handleCopyLink = () => {
    handleCopyDatabaseLink();
  };

  const handleCopyAsMarkdown = async () => {
    try {
      clipboard.copy(getCurrentTableMarkdown());
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

  /**
   * We export markdown locally so that the file includes the current
   * the visual state of the table, and not the “raw” data from the server.
   */
  const handleExport = async (format: DatabaseExportFormat) => {
    if (format === DatabaseExportFormat.Markdown) {
      const markdown = getCurrentTableMarkdown();
      const rawName = (database?.name || databasePage?.title || 'database').trim();
      const safeName = rawName.replace(/\s+/g, '-').toLowerCase() || 'database';

      saveAs(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${safeName}.md`);
      notifications.show({ message: t('Export successful') });
      return;
    }

    await exportDatabase(databaseId, { format });
    notifications.show({ message: t('Export successful') });
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleOpenCommentsAside = () => {
    setAsideState({ tab: 'comments', isAsideOpen: true });
  };

  const handleDeletePage = () => {
    if (!databasePageId) {
      return;
    }

    openDeleteModal({
      onConfirm: async () => {
        await removePageMutationAsync(databasePageId);

        /**
         * We duplicate the local deletion for the database script explicitly in the UI layer of the menu,
         * so that the sidebar and current tree-state are cleared immediately even before refetch.
         */
        dropTreeNode(databasePageId);
      },
    });
  };


  /**
   * Confirms and starts the reverse conversion of database -> page.
   *
   * After a successful operation, we transfer the user to page-route,
   * so that the interface immediately opens a regular page instead of a database-view.
   */
  const handleConvertToPage = () => {
    modals.openConfirmModal({
      title: t('Convert database to page?'),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            'The database view, properties and row bindings will be deactivated. Child pages will stay in the tree as regular pages.',
          )}
        </Text>
      ),
      labels: { confirm: t('Convert to page'), cancel: t('Cancel') },
      confirmProps: {
        loading: isConvertingDatabaseToPage,
        leftSection: <IconArrowsExchange size={14} />,
      },
      onConfirm: async () => {
        const result = await convertDatabaseToPageAsync();
        notifications.show({ message: t('Database converted to page') });

        if (result?.slugId) {
          navigate(`/s/${spaceSlug}/p/${result.slugId}`);
        }
      },
    });
  };

  /**
   * For domain operations on a page, the existence of an associated pageId is sufficient.
   * If there is no pageId, this is the “root” database without page binding - we hide the page operations.
   */
  const hasDatabasePage = Boolean(databasePageId);

  /**
   * To move, you need the slugId of the page (used in MovePageModal).
   * If the page has not yet loaded or the slug is not available, hide the Move item.
   */
  const canMoveDatabasePage = Boolean(databasePageId && databasePage?.slugId);

  /**
   * Explicit priority for calculating page width:
   * 1) databasePage.settings.fullPageWidth;
   * 2) user.settings.preferences.fullPageWidth;
   * 3) fallback false.
   */
  const fullPageWidth =
    databasePage?.settings?.fullPageWidth ?? user.settings?.preferences?.fullPageWidth ?? false;

  /**
   * We pass exactly the database-page id to the general switch,
   * so that the change is saved in `databasePage.settings.fullPageWidth`.
   */
  const databasePageWidthScopeId = databasePage?.id ?? databasePageId;

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
            copyLinkLabel={t('Copy database link')}
            onCopyAsMarkdown={handleCopyAsMarkdown}
            onOpenHistory={hasDatabasePage ? openHistoryModal : undefined}
            onOpenExport={openExportModal}
            onPrint={handlePrint}
            databasePageId={databasePageWidthScopeId}
            fullPageWidth={fullPageWidth}
          />

          {hasDatabasePage && (
            <Menu.Item leftSection={<IconMessageCircle size={16} />} onClick={handleOpenCommentsAside}>
              {t('Comments')}
            </Menu.Item>
          )}

          {/**
           * For database root page (when pageId is missing) page-domain operation
           * (share/history/move/trash) are inaccessible and intentionally hidden.
           */}
          {!readOnly && canMoveDatabasePage && (
            <>
              <Menu.Divider />
              <Menu.Item leftSection={<IconArrowRight size={16} />} onClick={openMovePageModal}>
                {t('Move')}
              </Menu.Item>
            </>
          )}

          {!readOnly && (
            <>
              <Menu.Divider />
              <Menu.Item
                leftSection={<IconArrowsExchange size={16} />}
                onClick={handleConvertToPage}
                disabled={isConvertingDatabaseToPage}
              >
                {t('Convert to page')}
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
        onExportDatabase={handleExport}
      />

      {canMoveDatabasePage && (
        <MovePageModal
          pageId={databasePageId}
          slugId={databasePage.slugId}
          currentSpaceSlug={spaceSlug}
          onClose={closeMovePageModal}
          open={movePageModalOpened}
        />
      )}
    </>
  );
}
