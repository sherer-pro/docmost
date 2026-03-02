import { ActionIcon, Menu, Text } from '@mantine/core';
import { IconArrowRight, IconArrowsExchange, IconDots, IconLink, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import { useDisclosure } from '@mantine/hooks';
import { useAtom } from 'jotai';
import { useAtomValue } from 'jotai';
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
import { buildDatabaseUrl, buildPageUrl } from '@/features/page/page.utils.ts';
import { usePageQuery, useRemovePageMutation } from '@/features/page/queries/page-query.ts';
import { useConvertDatabaseToPageMutation } from '@/features/database/queries/database-query.ts';
import ShareModal from '@/features/share/components/share-modal.tsx';
import { PageStateSegmentedControl } from '@/features/user/components/page-state-pref.tsx';
import { useClipboard } from '@/hooks/use-clipboard';
import { getAppUrl } from '@/lib/config.ts';
import {
  databaseTableExportStateAtom,
  defaultDatabaseTableExportState,
} from '@/features/database/atoms/database-table-export-atom';
import { buildDatabaseMarkdownFromState } from '@/features/database/utils/database-markdown';

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
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const { data: page } = usePageQuery({ pageId: databasePageId });
  const { data: database } = useGetDatabaseQuery(databaseId);
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const { data: rows = [] } = useDatabaseRowsQuery(databaseId);
  const tableExportStateByDatabase = useAtomValue(databaseTableExportStateAtom);
  const { openDeleteModal } = useDeletePageModal();
  const { mutateAsync: removePageMutationAsync } = useRemovePageMutation();
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [movePageModalOpened, { open: openMovePageModal, close: closeMovePageModal }] =
    useDisclosure(false);
  const { mutateAsync: convertDatabaseToPageAsync, isPending: isConvertingDatabaseToPage } =
    useConvertDatabaseToPageMutation(page?.spaceId, databaseId);

  /**
   * Собирает markdown на клиенте в точном состоянии текущей таблицы:
   * учитываем сортировку, фильтры и видимые колонки из UI.
   */
  const getCurrentTableMarkdown = () => {
    const tableExportState = tableExportStateByDatabase[databaseId] ?? defaultDatabaseTableExportState;

    return buildDatabaseMarkdownFromState({
      title: (database?.name || page?.title || t('database.editor.untitled')).trim(),
      description: database?.description,
      properties,
      rows,
      state: tableExportState,
      untitledLabel: t('Untitled'),
    });
  };

  /**
   * Копирует canonical-ссылку на database-страницу в формате /s/:space/db/:slug.
   */
  const handleCopyDatabaseLink = () => {
    if (!page?.slugId) {
      return;
    }

    const databasePath = buildDatabaseUrl(spaceSlug, page.slugId, page.title);

    clipboard.copy(`${getAppUrl()}${databasePath}`);
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
   * Экспорт markdown выполняем локально, чтобы в файл попало текущее
   * визуальное состояние таблицы, а не "сырые" данные с сервера.
   */
  const handleExport = async (format: DatabaseExportFormat) => {
    if (format === DatabaseExportFormat.Markdown) {
      const markdown = getCurrentTableMarkdown();
      const rawName = (database?.name || page?.title || 'database').trim();
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


  /**
   * Подтверждает и запускает обратную конвертацию database -> page.
   *
   * После успешной операции переводим пользователя в page-route,
   * чтобы интерфейс сразу открыл обычную страницу вместо database-view.
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
   * Для domain-операций страницы достаточно факта существования связанной pageId.
   * При отсутствии pageId это «корневая» база без page-обвязки — page-операции скрываем.
   */
  const hasDatabasePage = Boolean(databasePageId);

  /**
   * Для перемещения нужен slugId страницы (используется в MovePageModal).
   * Если страница ещё не догрузилась или slug недоступен, пункт Move скрываем.
   */
  const canMoveDatabasePage = Boolean(databasePageId && page?.slugId);

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
          slugId={page.slugId}
          currentSpaceSlug={spaceSlug}
          onClose={closeMovePageModal}
          open={movePageModalOpened}
        />
      )}
    </>
  );
}
