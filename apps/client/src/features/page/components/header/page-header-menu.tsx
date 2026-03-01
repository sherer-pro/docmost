import { ActionIcon, Group, Menu, Text, Tooltip } from "@mantine/core";
import classes from "./page-header-menu.module.css";
import {
  IconArrowRight,
  IconArrowsExchange,
  IconDatabase,
  IconDots,
  IconList,
  IconMessage,
  IconTrash,
  IconWifiOff,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import useToggleAside from "@/hooks/use-toggle-aside.tsx";
import { useAtom, useAtomValue } from "jotai";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms.ts";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { useNavigate, useParams } from "react-router-dom";
import { useConvertPageToDatabaseMutation, usePageQuery } from "@/features/page/queries/page-query.ts";
import { useConvertDatabaseToPageMutation } from "@/features/database/queries/database-query.ts";
import { buildDatabaseUrl, buildPageUrl } from "@/features/page/page.utils.ts";
import { getPageById } from "@/features/page/services/page-service.ts";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { Trans, useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import { htmlToMarkdown } from "@docmost/editor-ext";
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

interface PageHeaderMenuProps {
  readOnly?: boolean;
}
export default function PageHeaderMenu({ readOnly }: PageHeaderMenuProps) {
  const { t } = useTranslation();
  const toggleAside = useToggleAside();

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

      {!readOnly && <PageStateSegmentedControl size="xs" />}

      <ShareModal readOnly={readOnly} />

      <Tooltip label={t("Comments")} openDelay={250} withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          onClick={() => toggleAside("comments")}
        >
          <IconMessage size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label={t("Table of contents")} openDelay={250} withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          onClick={() => toggleAside("toc")}
        >
          <IconList size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>

      <PageActionMenu readOnly={readOnly} />
    </>
  );
}


function ActivePageUsers() {
  const activePageUsers = useAtomValue(activePageUsersAtom);

  if (!activePageUsers.length) return null;

  return (
    <Group
      gap={6}
      wrap="nowrap"
      className={classes.activeUsers}
      aria-label="Active page users"
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
}
function PageActionMenu({ readOnly }: PageActionMenuProps) {
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
  const [pageEditor] = useAtom(pageEditorAtom);
  const pageUpdatedAt = useTimeAgo(page?.updatedAt);
  const navigate = useNavigate();
  const { mutateAsync: convertPageToDatabaseAsync, isPending: isConvertingPageToDatabase } =
    useConvertPageToDatabaseMutation();
  const { mutateAsync: convertDatabaseToPageAsync, isPending: isConvertingDatabaseToPage } =
    useConvertDatabaseToPageMutation(page?.spaceId, page?.databaseId ?? undefined);

  const handleCopyLink = () => {
    const pageUrl =
      getAppUrl() + buildPageUrl(spaceSlug, page.slugId, page.title);

    clipboard.copy(pageUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleCopyAsMarkdown = () => {
    if (!pageEditor) return;
    const html = pageEditor.getHTML();
    const markdown = htmlToMarkdown(html);
    const title = page?.title ? `# ${page.title}\n\n` : "";
    clipboard.copy(`${title}${markdown}`);
    notifications.show({ message: t("Copied") });
  };

  const handlePrint = () => {
    setTimeout(() => {
      window.print();
    }, 250);
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleDeletePage = () => {
    openDeleteModal({ onConfirm: () => tree?.delete(page.id) });
  };

  const handleConvertToPage = () => {
    if (!page?.databaseId) {
      return;
    }

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
          navigate(buildPageUrl(spaceSlug, result.slugId, page.title));
        }
      },
    });
  };

  const handleConvertToDatabase = () => {
    if (!page?.id) {
      return;
    }

    modals.openConfirmModal({
      title: t('Convert page to database?'),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            'The current page will become a database root. Existing child pages will be attached as database rows and keep their nested structure.',
          )}
        </Text>
      ),
      labels: { confirm: t('Convert to database'), cancel: t('Cancel') },
      confirmProps: { loading: isConvertingPageToDatabase, leftSection: <IconDatabase size={14} /> },
      onConfirm: async () => {
        const result = await convertPageToDatabaseAsync(page.id);
        notifications.show({ message: t('Page converted to database') });

        const convertedDatabasePage = await getPageById({ pageId: result.pageId });
        navigate(buildDatabaseUrl(spaceSlug, convertedDatabasePage.slugId, convertedDatabasePage.title));
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
          <ActionIcon variant="subtle" color="dark">
            <IconDots size={20} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <DocumentCommonActionItems
            onCopyLink={handleCopyLink}
            onCopyAsMarkdown={handleCopyAsMarkdown}
            onOpenHistory={openHistoryModal}
            onOpenExport={openExportModal}
            onPrint={handlePrint}
          />

          {!readOnly && (
            <>
              <Menu.Divider />
              <Menu.Item
                leftSection={<IconArrowRight size={16} />}
                onClick={openMovePageModal}
              >
                {t("Move")}
              </Menu.Item>
              {!page?.databaseId && (
                <>
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconArrowsExchange size={16} />}
                  onClick={handleConvertToDatabase}
                  disabled={isConvertingPageToDatabase}
                >
                  {t('Convert to database')}
                </Menu.Item>
                </>
              )}
            </>
          )}

          {!readOnly && page?.databaseId && (
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

          {!readOnly && (
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
    </>
  );
}

function ConnectionWarning() {
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
      <ActionIcon variant="default" c="red" style={{ border: "none" }}>
        <IconWifiOff size={20} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );
}
