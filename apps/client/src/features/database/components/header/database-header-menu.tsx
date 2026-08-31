import { Menu, Tooltip } from "@mantine/core";
import {
  IconArrowsExchange,
  IconDots,
  IconInfoCircle,
  IconList,
  IconMessage,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import { DocumentCommonActionItems } from "@/features/common/header/document-common-action-items.tsx";
import {
  exportDatabase,
  getDatabaseRows,
} from "@/features/database/services/database-service";
import {
  DatabaseExportFormat,
  IExportDatabasePayload,
} from "@/features/database/types/database.types";
import { useDatabasePropertiesQuery } from "@/features/database/queries/database-table-query.ts";
import { useGetDatabaseQuery } from "@/features/database/queries/database-query.ts";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms.ts";
import MovePageModal from "@/features/page/components/move-page-modal.tsx";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { buildDatabaseUrl } from "@/features/page/page.utils.ts";
import { useRemovePageMutation } from "@/features/page/queries/page-query.ts";
import { useConvertDatabaseToPageMutation } from "@/features/database/queries/database-query.ts";
import { useDocumentConversionActions } from "@/features/page/hooks/use-document-conversion-actions.ts";
import {
  ActivePageUsers,
  ConnectionWarning,
} from "@/features/page/components/header/page-header-menu.tsx";
import ShareModal from "@/features/share/components/share-modal.tsx";
import { PageStateSegmentedControl } from "@/features/user/components/page-state-pref.tsx";
import { useClipboard } from "@/hooks/use-clipboard";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { getAppUrl } from "@/lib/config.ts";
import {
  databaseTableExportStateAtom,
  defaultDatabaseTableExportState,
} from "@/features/database/atoms/database-table-export-atom";
import { buildDatabaseMarkdownFromState } from "@/features/database/utils/database-markdown";
import {
  IDatabaseRowsPage,
  IDatabaseRowsQueryParams,
  IDatabaseRowWithCells,
} from "@/features/database/types/database-table.types.ts";
import { dropTreeNodeAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import useToggleAside from "@/hooks/use-toggle-aside.tsx";
import { useDatabasePageContext } from "@/features/database/hooks/use-database-page-context.ts";
import PageAccessModal from "@/features/page/components/page-access-modal.tsx";
import { canOpenPageAccessModal } from "@/features/page/utils/page-access-ui.ts";
import { resolvePageFullWidth } from "@/features/user/utils/page-width.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import PageDetailsModal from "@/features/page/components/page-details-modal";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import {
  resolveHeadingNumberingEnabled,
  resolveSpaceHeadingNumberingEnabled,
} from "@/features/page/utils/heading-numbering";
import { getEditorMarkdown } from "@/features/editor/utils/editor-markdown";
import CopyPageModal from "@/features/page/components/copy-page-modal.tsx";
import { PageOperationMenuItems } from "@/features/page/components/page-operation-menu-items.tsx";
import { duplicatePage } from "@/features/page/services/page-service.ts";
import { invalidateSidebarTree } from "@/features/page/queries/cache-invalidation.ts";
import { queryClient } from "@/lib/query-client.ts";
import { useNavigate } from "react-router-dom";
import { canExportDocument } from "@/features/space/permissions/export-access.ts";
import { useAiAssistantIdentity } from "@/features/ai/hooks/use-ai-assistant-identity.ts";
import FavoriteButton from "@/features/favorite/components/favorite-button";

interface DatabaseHeaderMenuProps {
  databaseId: string;
  databasePageId?: string;
  spaceSlug: string;
  readOnly?: boolean;
}

const MARKDOWN_COPY_ROWS_PAGE_SIZE = 200;

function normalizeRowsResponse(
  data: IDatabaseRowWithCells[] | IDatabaseRowsPage,
): IDatabaseRowsPage {
  if (Array.isArray(data)) {
    return {
      items: data,
      nextCursor: null,
      hasMore: false,
    };
  }

  return {
    items: data.items ?? [],
    nextCursor: data.nextCursor ?? null,
    hasMore: Boolean(data.hasMore),
  };
}

export default function DatabaseHeaderMenu({
  databaseId,
  databasePageId,
  spaceSlug,
  readOnly,
}: DatabaseHeaderMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toggleAside = useToggleAside();
  const isMobileViewport = Boolean(useMediaQuery("(max-width: 48em)"));
  const clipboard = useClipboard({ timeout: 500 });
  const [user] = useAtom(userAtom);
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const databaseContext = useDatabasePageContext();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const { data: database } = useGetDatabaseQuery(databaseId);
  const resolvedDatabasePageId =
    databasePageId ?? databaseContext.databasePageId;
  const assistantIdentity = useAiAssistantIdentity(
    database?.spaceId ?? space?.id,
    resolvedDatabasePageId,
  );
  const databasePageSlugId = databaseContext.databasePageSlugId;
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const tableExportStateByDatabase = useAtomValue(databaseTableExportStateAtom);
  const pageEditor = useAtomValue(pageEditorAtom);
  const tableExportState =
    tableExportStateByDatabase[databaseId] ?? defaultDatabaseTableExportState;
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
  const { openDeleteModal } = useDeletePageModal();
  const { mutateAsync: removePageMutationAsync } = useRemovePageMutation();
  const dropTreeNode = useSetAtom(dropTreeNodeAtom);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [
    movePageModalOpened,
    { open: openMovePageModal, close: closeMovePageModal },
  ] = useDisclosure(false);
  const [
    copyPageModalOpened,
    { open: openCopyPageModal, close: closeCopyPageModal },
  ] = useDisclosure(false);
  const [
    accessModalOpened,
    { open: openAccessModal, close: closeAccessModal },
  ] = useDisclosure(false);
  const [
    detailsModalOpened,
    { open: openDetailsModal, close: closeDetailsModal },
  ] = useDisclosure(false);
  const {
    mutateAsync: convertDatabaseToPageAsync,
    isPending: isConvertingDatabaseToPage,
  } = useConvertDatabaseToPageMutation(database?.spaceId, databaseId);

  const { openConvertDatabaseToPageConfirm } = useDocumentConversionActions({
    spaceSlug,
    pageTitle: database?.name,
    isConvertingDatabaseToPage,
    convertDatabaseToPageAsync,
  });

  const getRowsForMarkdownCopy = async (): Promise<IDatabaseRowWithCells[]> => {
    const rows: IDatabaseRowWithCells[] = [];
    let cursor: string | null | undefined;

    while (true) {
      const rowsPage = normalizeRowsResponse(
        await getDatabaseRows(databaseId, {
          ...(rowsExportQueryParams ?? {}),
          limit: MARKDOWN_COPY_ROWS_PAGE_SIZE,
          cursor: cursor ?? undefined,
        }),
      );

      rows.push(...rowsPage.items);

      if (!rowsPage.hasMore || !rowsPage.nextCursor) {
        break;
      }

      cursor = rowsPage.nextCursor;
    }

    return rows;
  };

  const getCurrentTableMarkdown = async () => {
    const rows = await getRowsForMarkdownCopy();
    const descriptionMarkdown = pageEditor
      ? await getEditorMarkdown(
          pageEditor,
          resolveSpaceHeadingNumberingEnabled(
            space?.settings ?? databaseContext.pageByRoute?.space?.settings,
          ),
        )
      : undefined;

    return buildDatabaseMarkdownFromState({
      title: (database?.name || t("database.editor.untitled")).trim(),
      description: database?.description,
      descriptionMarkdown,
      properties,
      rows,
      state: tableExportState,
      untitledLabel: t("Untitled"),
      skipFilterAndSort: true,
    });
  };

  const getCurrentViewSnapshot = (): NonNullable<
    IExportDatabasePayload["currentView"]
  > => ({
    filters: rowsExportQueryParams?.filters,
    sortPropertyId: rowsExportQueryParams?.sortPropertyId,
    sortDirection: rowsExportQueryParams?.sortDirection,
    visiblePropertyIds: properties
      .filter((property) => {
        const explicitValue = tableExportState.visibleColumns[property.id];
        return typeof explicitValue === "boolean" ? explicitValue : true;
      })
      .map((property) => property.id),
  });

  const handleCopyDatabaseLink = () => {
    if (!databasePageSlugId) {
      return;
    }

    const databasePath = buildDatabaseUrl(
      spaceSlug,
      databasePageSlugId,
      database?.name ?? "",
    );

    clipboard.copy(`${getAppUrl()}${databasePath}`);
    notifications.show({ message: t("Link copied") });
  };

  const handleCopyLink = () => {
    handleCopyDatabaseLink();
  };

  const handleCopyAsMarkdown = async () => {
    try {
      clipboard.copy(await getCurrentTableMarkdown());
      notifications.show({ message: t("Copied") });
    } catch {
      notifications.show({
        message: t("Export failed"),
        color: "red",
      });
    }
  };

  const handlePrint = async () => {
    try {
      await exportDatabase(databaseId, {
        format: DatabaseExportFormat.PDF,
        currentView: getCurrentViewSnapshot(),
      });

      notifications.show({ message: t("Export successful") });
    } catch {
      notifications.show({
        message: t("Export failed"),
        color: "red",
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
      currentView:
        format === DatabaseExportFormat.Docmost
          ? undefined
          : getCurrentViewSnapshot(),
    });
    notifications.show({ message: t("Export successful") });
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleOpenCommentsAside = () => {
    toggleAside("comments");
  };

  const handleOpenTableOfContents = () => {
    toggleAside("toc");
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

  const handleDuplicateDatabase = async () => {
    if (!resolvedDatabasePageId) {
      return;
    }

    try {
      const duplicatedPage = await duplicatePage({
        pageId: resolvedDatabasePageId,
      });
      invalidateSidebarTree(
        { spaceId: duplicatedPage.spaceId },
        { client: queryClient },
      );
      navigate(
        buildDatabaseUrl(
          duplicatedPage.space?.slug ?? spaceSlug,
          duplicatedPage.slugId,
          duplicatedPage.title,
        ),
      );
      notifications.show({ message: t("Page duplicated successfully") });
    } catch (err) {
      notifications.show({
        message: err.response?.data.message || "An error occurred",
        color: "red",
      });
    }
  };

  const hasDatabasePage = Boolean(resolvedDatabasePageId);
  const canOpenAccessModal = canOpenPageAccessModal({
    pageId: resolvedDatabasePageId,
    canManageAccess:
      databaseContext.pageByRoute?.access?.capabilities?.canManageAccess,
  });
  const canMoveDatabasePage = Boolean(
    resolvedDatabasePageId && databasePageSlugId,
  );
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
  const headingNumberingEnabled = resolveHeadingNumberingEnabled({
    pageId: databasePageWidthScopeId,
    preferences: user?.settings?.preferences,
    spaceSettings:
      space?.settings ?? databaseContext.pageByRoute?.space?.settings,
  });
  const canExportCurrentDatabase = canExportDocument({
    parentPageId: databaseContext.pageByRoute?.parentPageId,
    workspaceRole: user?.role,
    spaceRole: space?.membership?.role,
  });

  return (
    <>
      <ConnectionWarning />

      <ActivePageUsers />

      {!readOnly && (
        <PageStateSegmentedControl
          size="xs"
          pageId={resolvedDatabasePageId}
          compact={isMobileViewport}
        />
      )}

      {!readOnly && hasDatabasePage && (
        <Tooltip
          label={assistantIdentity.text("openPanel")}
          openDelay={250}
          withArrow
        >
          <AccessibleActionIcon
            label={assistantIdentity.text("openPanel")}
            tooltip={false}
            variant="subtle"
            color="dark"
            data-page-header-action="ai"
            onClick={() => toggleAside("ai")}
          >
            <IconSparkles size={20} stroke={2} />
          </AccessibleActionIcon>
        </Tooltip>
      )}

      {hasDatabasePage && (
        <Tooltip label={t("Table of contents")} openDelay={250} withArrow>
          <AccessibleActionIcon
            label={t("Table of contents")}
            tooltip={false}
            variant="subtle"
            color="dark"
            data-page-header-action="toc"
            onClick={handleOpenTableOfContents}
          >
            <IconList size={20} stroke={2} />
          </AccessibleActionIcon>
        </Tooltip>
      )}

      {hasDatabasePage && (
        <Tooltip label={t("Comments")} openDelay={250} withArrow>
          <AccessibleActionIcon
            label={t("Comments")}
            tooltip={false}
            variant="subtle"
            color="dark"
            data-page-header-action="comments"
            onClick={handleOpenCommentsAside}
          >
            <IconMessage size={20} stroke={2} />
          </AccessibleActionIcon>
        </Tooltip>
      )}

      {!isMobileViewport &&
        !readOnly &&
        resolvedDatabasePageId &&
        (database?.spaceId ?? space?.id) && (
          <FavoriteButton
            type="page"
            id={resolvedDatabasePageId}
            spaceId={database?.spaceId ?? space?.id}
          />
        )}

      {hasDatabasePage && (
        <ShareModal
          pageId={resolvedDatabasePageId}
          readOnly={Boolean(readOnly)}
        />
      )}

      {!isMobileViewport && hasDatabasePage && (
        <Tooltip label={t("Page details")} openDelay={250} withArrow>
          <AccessibleActionIcon
            label={t("Page details")}
            tooltip={false}
            variant="subtle"
            color="dark"
            data-page-header-action="details"
            onClick={openDetailsModal}
          >
            <IconInfoCircle size={20} stroke={2} />
          </AccessibleActionIcon>
        </Tooltip>
      )}

      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={230}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <AccessibleActionIcon
            label={t("Open menu")}
            variant="subtle"
            color="dark"
            data-page-header-action="menu"
          >
            <IconDots size={20} />
          </AccessibleActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          {isMobileViewport && hasDatabasePage && (
            <>
              {!readOnly &&
                resolvedDatabasePageId &&
                (database?.spaceId ?? space?.id) && (
                  <FavoriteButton
                    type="page"
                    id={resolvedDatabasePageId}
                    spaceId={database?.spaceId ?? space?.id}
                    presentation="menu-item"
                  />
                )}
              <Menu.Item
                leftSection={<IconInfoCircle size={16} />}
                onClick={openDetailsModal}
                data-page-header-menu-action="details"
              >
                {t("Page details")}
              </Menu.Item>
              <Menu.Divider />
            </>
          )}

          <DocumentCommonActionItems
            onCopyLink={handleCopyLink}
            copyLinkLabel={t("Copy database link")}
            onCopyAsMarkdown={handleCopyAsMarkdown}
            onOpenHistory={hasDatabasePage ? openHistoryModal : undefined}
            onOpenExport={
              canExportCurrentDatabase ? openExportModal : undefined
            }
            onOpenAccess={canOpenAccessModal ? openAccessModal : undefined}
            onPrint={canExportCurrentDatabase ? handlePrint : undefined}
            databasePageId={databasePageWidthScopeId}
            fullPageWidth={fullPageWidth}
            headingNumbering={
              resolvedDatabasePageId && databaseContext.pageByRoute?.spaceId
                ? {
                    pageId: resolvedDatabasePageId,
                    checked: headingNumberingEnabled,
                    editor: pageEditor,
                    canWrite: !readOnly,
                  }
                : undefined
            }
          />

          {!readOnly && canMoveDatabasePage && (
            <>
              <Menu.Divider />
              <PageOperationMenuItems
                onDuplicate={() => void handleDuplicateDatabase()}
                onMove={openMovePageModal}
                onCopyToSpace={openCopyPageModal}
              />
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
                {t("Convert to page")}
              </Menu.Item>
            </>
          )}

          {!readOnly && hasDatabasePage && (
            <>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={handleDeletePage}
              >
                {t("Move to trash")}
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
        <>
          <MovePageModal
            pageId={resolvedDatabasePageId}
            slugId={databasePageSlugId}
            currentSpaceSlug={spaceSlug}
            nodeType="database"
            title={database?.name}
            onClose={closeMovePageModal}
            open={movePageModalOpened}
          />
          <CopyPageModal
            pageId={resolvedDatabasePageId}
            currentSpaceSlug={spaceSlug}
            nodeType="database"
            onClose={closeCopyPageModal}
            open={copyPageModalOpened}
          />
        </>
      )}

      {resolvedDatabasePageId && (
        <PageAccessModal
          pageId={resolvedDatabasePageId}
          open={accessModalOpened}
          onClose={closeAccessModal}
        />
      )}

      {resolvedDatabasePageId && (
        <PageDetailsModal
          pageId={resolvedDatabasePageId}
          page={databaseContext.pageByRoute}
          open={detailsModalOpened}
          onClose={closeDetailsModal}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
