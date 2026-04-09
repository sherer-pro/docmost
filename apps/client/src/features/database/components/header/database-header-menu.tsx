import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconArrowRight, IconArrowsExchange, IconDots, IconList, IconMessage, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
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
import { useRemovePageMutation } from '@/features/page/queries/page-query.ts';
import { useConvertDatabaseToPageMutation } from '@/features/database/queries/database-query.ts';
import { useDocumentConversionActions } from '@/features/page/hooks/use-document-conversion-actions.ts';
import {
  ActivePageUsers,
  ConnectionWarning,
} from '@/features/page/components/header/page-header-menu.tsx';
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
import { IDatabaseRowsQueryParams } from '@/features/database/types/database-table.types.ts';
import { dropTreeNodeAtom } from '@/features/page/tree/atoms/tree-data-atom.ts';
import useToggleAside from '@/hooks/use-toggle-aside.tsx';
import { useDatabasePageContext } from '@/features/database/hooks/use-database-page-context.ts';
import PageAccessModal from '@/features/page/components/page-access-modal.tsx';
import { canOpenPageAccessModal } from '@/features/page/utils/page-access-ui.ts';
import { resolvePageFullWidth } from '@/features/user/utils/page-width.ts';

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
  const toggleAside = useToggleAside();
  const clipboard = useClipboard({ timeout: 500 });
  const [user] = useAtom(userAtom);
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const databaseContext = useDatabasePageContext();
  const { data: database } = useGetDatabaseQuery(databaseId);
  const resolvedDatabasePageId = databasePageId ?? databaseContext.databasePageId;
  const databasePageSlugId = databaseContext.databasePageSlugId;
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const tableExportStateByDatabase = useAtomValue(databaseTableExportStateAtom);
  const tableExportState = tableExportStateByDatabase[databaseId] ?? defaultDatabaseTableExportState;
  const rowsExportQueryParams = (() => {
    const params = tableExportState.rowsQueryParams;
    if (!params) {
      return undefined;
    }

    return {
      ...params,
      limit: undefined,
      cursor: undefined,
    } as IDatabaseRowsQueryParams;
  })();
  const { data: rowsPage } = useDatabaseRowsQuery(databaseId, rowsExportQueryParams);
  const rows = rowsPage?.items ?? [];
  const { openDeleteModal } = useDeletePageModal();
  const { mutateAsync: removePageMutationAsync } = useRemovePageMutation();
  const dropTreeNode = useSetAtom(dropTreeNodeAtom);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [movePageModalOpened, { open: openMovePageModal, close: closeMovePageModal }] =
    useDisclosure(false);
  const [accessModalOpened, { open: openAccessModal, close: closeAccessModal }] =
    useDisclosure(false);
  const { mutateAsync: convertDatabaseToPageAsync, isPending: isConvertingDatabaseToPage } =
    useConvertDatabaseToPageMutation(database?.spaceId, databaseId);

  const { openConvertDatabaseToPageConfirm } = useDocumentConversionActions({
    spaceSlug,
    pageTitle: database?.name,
    isConvertingDatabaseToPage,
    convertDatabaseToPageAsync,
  });

  const getCurrentTableMarkdown = () => {
    return buildDatabaseMarkdownFromState({
      title: (database?.name || t('database.editor.untitled')).trim(),
      description: database?.description,
      properties,
      rows,
      state: tableExportState,
      untitledLabel: t('Untitled'),
      skipFilterAndSort: true,
    });
  };

  const handleCopyDatabaseLink = () => {
    if (!databasePageSlugId) {
      return;
    }

    const databasePath = buildDatabaseUrl(spaceSlug, databasePageSlugId, database?.name ?? '');

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

  const handleExport = async (
    format: DatabaseExportFormat,
    options?: { includeChildren?: boolean; includeAttachments?: boolean },
  ) => {
    await exportDatabase(databaseId, {
      format,
      includeChildren: options?.includeChildren,
      includeAttachments: options?.includeAttachments,
    });
    notifications.show({ message: t('Export successful') });
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleOpenCommentsAside = () => {
    toggleAside('comments');
  };

  const handleOpenTableOfContents = () => {
    toggleAside('toc');
  };

  const handleDeletePage = () => {
    if (!resolvedDatabasePageId) {
      return;
    }

    openDeleteModal({
      onConfirm: async () => {
        await removePageMutationAsync(resolvedDatabasePageId);
        dropTreeNode(resolvedDatabasePageId);
      },
    });
  };

  const hasDatabasePage = Boolean(resolvedDatabasePageId);
  const canOpenAccessModal = canOpenPageAccessModal({
    pageId: resolvedDatabasePageId,
    canManageAccess: databaseContext.pageByRoute?.access?.capabilities?.canManageAccess,
  });
  const canMoveDatabasePage = Boolean(resolvedDatabasePageId && databasePageSlugId);
  const databasePageWidthScopeId = resolvedDatabasePageId;

  /**
   * Keep the same width resolution priority as regular page header:
   * 1) user page-level override;
   * 2) user global default preference;
   * 3) safe fallback `false`.
   */
  const fullPageWidth = resolvePageFullWidth({
    pageId: databasePageWidthScopeId,
    preferences: user?.settings?.preferences,
  });

  return (
    <>
      <ConnectionWarning />

      <ActivePageUsers />

      {!readOnly && <PageStateSegmentedControl size="xs" />}

      {hasDatabasePage && (
        <ShareModal pageId={resolvedDatabasePageId} readOnly={Boolean(readOnly)} />
      )}

      {hasDatabasePage && (
        <Tooltip label={t('Comments')} openDelay={250} withArrow>
          <ActionIcon variant="subtle" color="dark" onClick={handleOpenCommentsAside}>
            <IconMessage size={20} stroke={2} />
          </ActionIcon>
        </Tooltip>
      )}

      <Tooltip label={t('Table of contents')} openDelay={250} withArrow>
        <ActionIcon variant="subtle" color="dark" onClick={handleOpenTableOfContents}>
          <IconList size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>

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
            onOpenAccess={canOpenAccessModal ? openAccessModal : undefined}
            onPrint={handlePrint}
            databasePageId={databasePageWidthScopeId}
            fullPageWidth={fullPageWidth}
          />

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
                onClick={openConvertDatabaseToPageConfirm}
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
          pageId={resolvedDatabasePageId}
          slugId={databasePageSlugId}
          currentSpaceSlug={spaceSlug}
          onClose={closeMovePageModal}
          open={movePageModalOpened}
        />
      )}

      {resolvedDatabasePageId && (
        <PageAccessModal
          pageId={resolvedDatabasePageId}
          open={accessModalOpened}
          onClose={closeAccessModal}
        />
      )}
    </>
  );
}
