import { Group, Menu, Text, Tooltip } from "@mantine/core";
import classes from "./page-header-menu.module.css";
import {
  IconArrowsExchange,
  IconDatabase,
  IconDots,
  IconInfoCircle,
  IconList,
  IconMessage,
  IconTrash,
  IconWifiOff,
  IconSparkles,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import useToggleAside from "@/hooks/use-toggle-aside.tsx";
import { useAtom, useAtomValue } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms.ts";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { useNavigate, useParams } from "react-router-dom";
import {
  useConvertPageToDatabaseMutation,
  usePageQuery,
} from "@/features/page/queries/page-query.ts";
import { useConvertDatabaseToPageMutation } from "@/features/database/queries/database-query.ts";
import { useDocumentConversionActions } from "@/features/page/hooks/use-document-conversion-actions.ts";
import { buildDatabaseUrl, buildPageUrl } from "@/features/page/page.utils.ts";
import {
  copyPageMarkdownWithComments,
  duplicatePage,
  getPageById,
} from "@/features/page/services/page-service.ts";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { Trans, useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import {
  activePageUsersAtom,
  pageEditorAtom,
  yjsConnectionStatusAtom,
} from "@/features/editor/atoms/editor-atoms.ts";
import { formattedDate } from "@/lib/time.ts";
import { PageStateSegmentedControl } from "@/features/user/components/page-state-pref.tsx";
import MovePageModal from "@/features/page/components/move-page-modal.tsx";
import { useTimeAgo } from "@/hooks/use-time-ago.tsx";
import ShareModal from "@/features/share/components/share-modal.tsx";
import { DocumentCommonActionItems } from "@/features/common/header/document-common-action-items.tsx";
import PageAccessModal from "@/features/page/components/page-access-modal.tsx";
import { canOpenPageAccessModal } from "@/features/page/utils/page-access-ui.ts";
import { resolvePageFullWidth } from "@/features/user/utils/page-width.ts";
import FavoriteButton from "@/features/favorite/components/favorite-button";
import PageDetailsModal from "@/features/page/components/page-details-modal";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { useSpaceQuery } from "@/features/space/queries/space-query";
import {
  resolveHeadingNumberingEnabled,
  resolveSpaceHeadingNumberingEnabled,
} from "@/features/page/utils/heading-numbering";
import { getEditorMarkdown } from "@/features/editor/utils/editor-markdown";
import CopyPageModal from "@/features/page/components/copy-page-modal.tsx";
import { PageOperationMenuItems } from "@/features/page/components/page-operation-menu-items.tsx";
import { invalidateSidebarTree } from "@/features/page/queries/cache-invalidation.ts";
import { queryClient } from "@/main.tsx";
import { canExportDocument } from "@/features/space/permissions/export-access.ts";
import { useAiAssistantIdentity } from "@/features/ai/hooks/use-ai-assistant-identity.ts";

interface PageHeaderMenuProps {
  readOnly?: boolean;
  canMoveDeleteShare?: boolean;
}
export default function PageHeaderMenu({
  readOnly,
  canMoveDeleteShare,
}: PageHeaderMenuProps) {
  const { t } = useTranslation();
  const toggleAside = useToggleAside();
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const assistantIdentity = useAiAssistantIdentity(page?.spaceId, page?.id);
  const pageCapabilities = page?.access?.capabilities;
  const canWritePage = pageCapabilities?.canWrite ?? !readOnly;
  const canMoveDeleteSharePage =
    pageCapabilities?.canMoveDeleteShare ?? canMoveDeleteShare ?? !readOnly;
  const isReadOnly = !canWritePage;

  useHotkeys([
    [
      "mod+F",
      () => {
        const event = new CustomEvent("openFindDialogFromEditor", {});
        document.dispatchEvent(event);
      },
    ],
    [
      "Escape",
      () => {
        const event = new CustomEvent("closeFindDialogFromEditor", {});
        document.dispatchEvent(event);
      },
      { preventDefault: false },
    ],
  ]);

  return (
    <>
      <ConnectionWarning />

      <ActivePageUsers />

      {!isReadOnly && <PageStateSegmentedControl size="xs" pageId={page?.id} />}

      {!isReadOnly && (
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
            onClick={() => toggleAside("ai")}
          >
            <IconSparkles size={20} stroke={2} />
          </AccessibleActionIcon>
        </Tooltip>
      )}

      <PageFavoriteAction readOnly={isReadOnly} />

      <ShareModal readOnly={!canMoveDeleteSharePage} />

      <PageDetailsAction readOnly={isReadOnly} />

      <Tooltip label={t("Comments")} openDelay={250} withArrow>
        <AccessibleActionIcon
          label={t("Comments")}
          tooltip={false}
          variant="subtle"
          color="dark"
          onClick={() => toggleAside("comments")}
        >
          <IconMessage size={20} stroke={2} />
        </AccessibleActionIcon>
      </Tooltip>

      <Tooltip label={t("Table of contents")} openDelay={250} withArrow>
        <AccessibleActionIcon
          label={t("Table of contents")}
          tooltip={false}
          variant="subtle"
          color="dark"
          onClick={() => toggleAside("toc")}
        >
          <IconList size={20} stroke={2} />
        </AccessibleActionIcon>
      </Tooltip>

      <PageActionMenu
        readOnly={isReadOnly}
        canMoveDeleteShare={canMoveDeleteSharePage}
      />
    </>
  );
}

function PageFavoriteAction({ readOnly }: PageHeaderMenuProps) {
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });

  if (readOnly || !page?.id) {
    return null;
  }

  return <FavoriteButton type="page" id={page.id} spaceId={page.spaceId} />;
}

function PageDetailsAction({ readOnly }: PageHeaderMenuProps) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const [opened, { open, close }] = useDisclosure(false);

  if (!page?.id) {
    return null;
  }

  return (
    <>
      <Tooltip label={t("Page details")} openDelay={250} withArrow>
        <AccessibleActionIcon
          label={t("Page details")}
          tooltip={false}
          variant="subtle"
          color="dark"
          onClick={open}
        >
          <IconInfoCircle size={20} stroke={2} />
        </AccessibleActionIcon>
      </Tooltip>

      <PageDetailsModal
        pageId={page.id}
        page={page}
        open={opened}
        onClose={close}
        readOnly={readOnly}
      />
    </>
  );
}

export function ActivePageUsers() {
  const { t } = useTranslation();
  const activePageUsers = useAtomValue(activePageUsersAtom);

  if (!activePageUsers.length) return null;

  return (
    <Group
      gap={6}
      wrap="nowrap"
      className={classes.activeUsers}
      aria-label={t("Active page users")}
    >
      {activePageUsers.map((user) => (
        <Tooltip key={user.id} label={user.name} withArrow openDelay={250}>
          <CustomAvatar
            avatarUrl={user.avatarUrl}
            name={user.name}
            size={26}
            radius="xl"
          />
        </Tooltip>
      ))}
    </Group>
  );
}

interface PageActionMenuProps {
  readOnly?: boolean;
  canMoveDeleteShare?: boolean;
}
function PageActionMenu({ readOnly, canMoveDeleteShare }: PageActionMenuProps) {
  const { t } = useTranslation();
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const clipboard = useClipboard({ timeout: 500 });
  const { pageSlug, spaceSlug } = useParams();
  const { data: page, isLoading } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const { openDeleteModal } = useDeletePageModal();
  const [tree] = useAtom(treeApiAtom);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [
    movePageModalOpened,
    { open: openMovePageModal, close: closeMoveSpaceModal },
  ] = useDisclosure(false);
  const [
    copyPageModalOpened,
    { open: openCopyPageModal, close: closeCopySpaceModal },
  ] = useDisclosure(false);
  const [
    accessModalOpened,
    { open: openAccessModal, close: closeAccessModal },
  ] = useDisclosure(false);
  const [pageEditor] = useAtom(pageEditorAtom);
  const [user] = useAtom(userAtom);
  const isWorkspaceAdmin = user?.role === "owner" || user?.role === "admin";
  const canOpenAccessModal = canOpenPageAccessModal({
    pageId: page?.id,
    canManageAccess: page?.access?.capabilities?.canManageAccess,
  });
  const canMoveDeleteSharePage =
    page?.access?.capabilities?.canMoveDeleteShare ??
    canMoveDeleteShare ??
    !readOnly;
  const canWritePage = page?.access?.capabilities?.canWrite ?? !readOnly;
  const { data: currentSpace } = useSpaceQuery(page?.spaceId ?? "");
  const canExportPage = canExportDocument({
    parentPageId: page?.parentPageId,
    workspaceRole: user?.role,
    spaceRole: currentSpace?.membership?.role,
  });

  /**
   * Explicit priority for calculating page width:
   * 1) user page-level override;
   * 2) user global default;
   * 3) safe fallback `false`.
   */
  const fullPageWidth = resolvePageFullWidth({
    pageId: page?.id,
    preferences: user?.settings?.preferences,
  });
  const resolvedSpaceSettings = currentSpace?.settings ?? page?.space?.settings;
  const spaceHeadingNumberingEnabled = resolveSpaceHeadingNumberingEnabled(
    resolvedSpaceSettings,
  );
  const headingNumberingEnabled = resolveHeadingNumberingEnabled({
    pageId: page?.id,
    preferences: user?.settings?.preferences,
    spaceSettings: resolvedSpaceSettings,
  });
  const pageUpdatedAt = useTimeAgo(page?.updatedAt);
  const navigate = useNavigate();
  const {
    mutateAsync: convertPageToDatabaseAsync,
    isPending: isConvertingPageToDatabase,
  } = useConvertPageToDatabaseMutation();
  const {
    mutateAsync: convertDatabaseToPageAsync,
    isPending: isConvertingDatabaseToPage,
  } = useConvertDatabaseToPageMutation(
    page?.spaceId,
    page?.databaseId ?? undefined,
  );

  const { openConvertDatabaseToPageConfirm } = useDocumentConversionActions({
    spaceSlug,
    pageTitle: page?.title,
    isConvertingDatabaseToPage,
    convertDatabaseToPageAsync,
  });

  const handleCopyLink = () => {
    const pageUrl =
      getAppUrl() + buildPageUrl(spaceSlug, page.slugId, page.title);

    clipboard.copy(pageUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleCopyAsMarkdown = () => {
    if (!pageEditor) return;
    const markdown = getEditorMarkdown(
      pageEditor,
      spaceHeadingNumberingEnabled,
    );
    const title = page?.title ? `# ${page.title}\n\n` : "";
    clipboard.copy(`${title}${markdown}`);
    notifications.show({ message: t("Copied") });
  };

  const handleCopyMarkdownWithComments = async () => {
    if (!page?.id) return;

    try {
      const markdown = await copyPageMarkdownWithComments(page.id);
      clipboard.copy(markdown);
      notifications.show({ message: t("Copied") });
    } catch {
      notifications.show({
        message: t("Failed to copy Markdown with comments"),
        color: "red",
      });
    }
  };

  const handlePrint = () => {
    if (!pageEditor) {
      window.print();
      return;
    }

    pageEditor.commands.setHeadingNumberingEnabled(
      spaceHeadingNumberingEnabled,
    );

    setTimeout(() => {
      let restored = false;
      const restorePersonalNumbering = () => {
        if (restored) {
          return;
        }

        restored = true;
        window.removeEventListener("afterprint", restorePersonalNumbering);
        pageEditor.commands.setHeadingNumberingEnabled(headingNumberingEnabled);
      };

      window.addEventListener("afterprint", restorePersonalNumbering, {
        once: true,
      });

      try {
        window.print();
      } finally {
        window.setTimeout(restorePersonalNumbering, 0);
      }
    }, 250);
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleDeletePage = () => {
    openDeleteModal({ onConfirm: () => tree?.delete(page.id) });
  };

  const handleDuplicatePage = async () => {
    if (!page?.id) {
      return;
    }

    try {
      const duplicatedPage = await duplicatePage({ pageId: page.id });
      invalidateSidebarTree(
        { spaceId: duplicatedPage.spaceId },
        { client: queryClient },
      );
      navigate(
        buildPageUrl(
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

  const handleConvertToPage = () => {
    if (!page?.databaseId) {
      return;
    }

    openConvertDatabaseToPageConfirm();
  };

  const handleConvertToDatabase = () => {
    if (!page?.id) {
      return;
    }

    modals.openConfirmModal({
      title: t("Convert page to database?"),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            "The current page will become a database root. Existing child pages will be attached as database rows and keep their nested structure.",
          )}
        </Text>
      ),
      labels: { confirm: t("Convert to database"), cancel: t("Cancel") },
      confirmProps: {
        loading: isConvertingPageToDatabase,
        leftSection: <IconDatabase size={14} />,
      },
      onConfirm: async () => {
        const result = await convertPageToDatabaseAsync(page.id);
        notifications.show({ message: t("Page converted to database") });

        const convertedDatabasePage = await getPageById({
          pageId: result.pageId,
        });
        navigate(
          buildDatabaseUrl(
            spaceSlug,
            convertedDatabasePage.slugId,
            convertedDatabasePage.title,
          ),
        );
      },
    });
  };

  return (
    <>
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
          >
            <IconDots size={20} />
          </AccessibleActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <DocumentCommonActionItems
            onCopyLink={handleCopyLink}
            onCopyAsMarkdown={handleCopyAsMarkdown}
            onCopyMarkdownWithComments={
              isWorkspaceAdmin ? handleCopyMarkdownWithComments : undefined
            }
            onOpenHistory={openHistoryModal}
            onOpenExport={canExportPage ? openExportModal : undefined}
            onOpenAccess={canOpenAccessModal ? openAccessModal : undefined}
            onPrint={handlePrint}
            pageId={page?.id}
            fullPageWidth={fullPageWidth}
            headingNumbering={
              page?.id && page.spaceId
                ? {
                    pageId: page.id,
                    checked: headingNumberingEnabled,
                    editor: pageEditor,
                    canWrite: canWritePage,
                  }
                : undefined
            }
          />

          {canMoveDeleteSharePage && (
            <>
              <Menu.Divider />
              <PageOperationMenuItems
                onDuplicate={() => void handleDuplicatePage()}
                onMove={openMovePageModal}
                onCopyToSpace={openCopyPageModal}
              />
              {!page?.databaseId && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    leftSection={<IconArrowsExchange size={16} />}
                    onClick={handleConvertToDatabase}
                    disabled={isConvertingPageToDatabase}
                  >
                    {t("Convert to database")}
                  </Menu.Item>
                </>
              )}
            </>
          )}

          {canMoveDeleteSharePage && page?.databaseId && (
            <>
              <Menu.Divider />
              <Menu.Item
                leftSection={<IconArrowsExchange size={16} />}
                onClick={handleConvertToPage}
                disabled={isConvertingDatabaseToPage}
              >
                {t("Convert to page")}
              </Menu.Item>
            </>
          )}

          {canMoveDeleteSharePage && (
            <>
              <Menu.Divider />
              <Menu.Item
                color={"red"}
                leftSection={<IconTrash size={16} />}
                onClick={handleDeletePage}
              >
                {t("Move to trash")}
              </Menu.Item>
            </>
          )}

          <Menu.Divider />

          <>
            <Group px="sm" wrap="nowrap" style={{ cursor: "pointer" }}>
              <Tooltip
                label={t("Edited by {{name}} {{time}}", {
                  name: page.lastUpdatedBy.name,
                  time: pageUpdatedAt,
                })}
                position="left-start"
              >
                <div style={{ width: 210 }}>
                  <Text size="xs" c="dimmed" truncate="end">
                    {t("Word count: {{wordCount}}", {
                      wordCount: pageEditor?.storage?.characterCount?.words(),
                    })}
                  </Text>

                  <Text size="xs" c="dimmed" lineClamp={1}>
                    <Trans
                      defaults="Created by: <b>{{creatorName}}</b>"
                      values={{ creatorName: page?.creator?.name }}
                      components={{ b: <Text span fw={500} /> }}
                    />
                  </Text>
                  <Text size="xs" c="dimmed" truncate="end">
                    {t("Created at: {{time}}", {
                      time: formattedDate(page.createdAt),
                    })}
                  </Text>
                </div>
              </Tooltip>
            </Group>
          </>
        </Menu.Dropdown>
      </Menu>

      <ExportModal
        type="page"
        id={page.id}
        open={exportOpened}
        onClose={closeExportModal}
      />

      <MovePageModal
        pageId={page.id}
        slugId={page.slugId}
        currentSpaceSlug={spaceSlug}
        onClose={closeMoveSpaceModal}
        open={movePageModalOpened}
      />

      <CopyPageModal
        pageId={page.id}
        currentSpaceSlug={spaceSlug}
        onClose={closeCopySpaceModal}
        open={copyPageModalOpened}
      />

      {page?.id && (
        <PageAccessModal
          pageId={page.id}
          open={accessModalOpened}
          onClose={closeAccessModal}
        />
      )}
    </>
  );
}

export function ConnectionWarning() {
  const { t } = useTranslation();
  const yjsConnectionStatus = useAtomValue(yjsConnectionStatusAtom);
  const [showWarning, setShowWarning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isDisconnected = ["disconnected", "connecting"].includes(
      yjsConnectionStatus,
    );

    if (isDisconnected) {
      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => setShowWarning(true), 5000);
      }
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setShowWarning(false);
    }
  }, [yjsConnectionStatus]);

  // Cleanup only on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!showWarning) return null;

  return (
    <Tooltip
      label={t("Real-time editor connection lost. Retrying...")}
      openDelay={250}
      withArrow
    >
      <AccessibleActionIcon
        label={t("Real-time editor connection lost. Retrying...")}
        tooltip={false}
        variant="default"
        c="red"
        style={{ border: "none" }}
      >
        <IconWifiOff size={20} stroke={2} />
      </AccessibleActionIcon>
    </Tooltip>
  );
}
