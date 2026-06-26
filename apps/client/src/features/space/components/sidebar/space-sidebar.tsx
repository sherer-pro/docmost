import {
  ActionIcon,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconBook2,
  IconDots,
  IconHexagonPlus,
  IconFileExport,
  IconHome,
  IconPlus,
  IconSquareRoundedPlus,
  IconSearch,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import classes from "./space-sidebar.module.css";
import React from "react";
import { useAtom } from "jotai";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import { Link, useLocation, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useDisclosure } from "@mantine/hooks";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import SpaceTree from "@/features/page/tree/components/space-tree.tsx";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import PageImportModal from "@/features/page/components/page-import-modal.tsx";
import { useTranslation } from "react-i18next";
import { SwitchSpace } from "./switch-space";
import ExportModal from "@/components/common/export-modal";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import { searchSpotlight } from "@/features/search/constants";
import { useCreateDatabaseMutation } from "@/features/database/queries/database-query.ts";
import { notifications } from "@mantine/notifications";
import { queryClient } from "@/main.tsx";
import { getPageById } from "@/features/page/services/page-service.ts";
import { buildDatabaseUrl } from "@/features/page/page.utils.ts";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { buildPageEditModeByPageId } from "@/features/user/utils/page-edit-mode.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import {
  insertOrUpdateTreeNode,
  mapDatabaseToTreeNode,
} from "@/features/page/tree/utils";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { PAGE_QUERY_KEYS } from "@/features/page/queries/query-keys.ts";

const PAGE_TREE_ACTION_SIZE = 24;
const PAGE_TREE_ACTION_ICON_SIZE = 16;

export function SpaceSidebar() {
  const { t } = useTranslation();
  const [tree] = useAtom(treeApiAtom);
  const location = useLocation();
  const [opened, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const [user, setUser] = useAtom(userAtom);
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const emit = useQueryEmit();
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const navigate = useNavigate();

  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);
  const createDatabaseMutation = useCreateDatabaseMutation(space?.id);

  if (!space) {
    return <></>;
  }

  function handleCreatePage() {
    tree?.create({ parentId: null, type: "internal", index: 0 });
  }

  async function handleCreateDatabase() {
    if (!space?.id || createDatabaseMutation.isPending) {
      return;
    }

    try {
      const createdDatabase = await createDatabaseMutation.mutateAsync({
        spaceId: space.id,
      });

      notifications.show({ message: t("Database created") });

      // After creating the database, open only the canonical URL of the /s/:space/db/:slug format.
      if (!createdDatabase.pageId) {
        notifications.show({
          message: t("Failed to create database"),
          color: "red",
        });
        return;
      }

      if (user) {
        setUser({
          ...user,
          settings: {
            ...user.settings,
            preferences: {
              ...user.settings?.preferences,
              pageEditModeByPageId: buildPageEditModeByPageId(
                user.settings?.preferences?.pageEditModeByPageId,
                createdDatabase.pageId,
                PageEditMode.Edit,
              ),
            },
          },
        });
      }

      const databasePage = await getPageById({
        pageId: createdDatabase.pageId,
      });
      queryClient.setQueryData(
        PAGE_QUERY_KEYS.page(databasePage.id),
        databasePage,
      );
      queryClient.setQueryData(
        PAGE_QUERY_KEYS.page(databasePage.slugId),
        databasePage,
      );

      const treeNodeData = mapDatabaseToTreeNode(createdDatabase, databasePage);
      const {
        tree: nextTreeData,
        index: insertionIndex,
        inserted,
      } = insertOrUpdateTreeNode(treeData, treeNodeData);
      setTreeData(nextTreeData);

      if (treeNodeData.parentPageId) {
        tree?.open(treeNodeData.parentPageId);
      }

      if (inserted) {
        setTimeout(() => {
          emit({
            operation: "addTreeNode",
            spaceId: treeNodeData.spaceId,
            payload: {
              parentId: treeNodeData.parentPageId,
              index: insertionIndex,
              node: treeNodeData,
            },
          });
        }, 50);
      }

      navigate(
        buildDatabaseUrl(spaceSlug, databasePage.slugId, databasePage.title),
      );
    } catch {
      notifications.show({
        message: t("Failed to create database"),
        color: "red",
      });
    }
  }

  return (
    <>
      <div className={classes.navbar}>
        <div
          className={classes.section}
          style={{
            border: "none",
            marginTop: 2,
            marginBottom: 3,
          }}
        >
          <SwitchSpace
            spaceName={space?.name}
            spaceSlug={space?.slug}
            spaceIcon={space?.logo}
          />
        </div>

        <div className={classes.section}>
          <div className={classes.menuItems}>
            <UnstyledButton
              component={Link}
              to={getSpaceUrl(spaceSlug)}
              className={clsx(
                classes.menu,
                location.pathname.toLowerCase() === getSpaceUrl(spaceSlug)
                  ? classes.activeButton
                  : "",
              )}
            >
              <div className={classes.menuItemInner}>
                <IconHome
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Overview")}</span>
              </div>
            </UnstyledButton>

            <UnstyledButton
              className={classes.menu}
              onClick={searchSpotlight.open}
            >
              <div className={classes.menuItemInner}>
                <IconSearch
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Search")}</span>
              </div>
            </UnstyledButton>

            <UnstyledButton className={classes.menu} onClick={openSettings}>
              <div className={classes.menuItemInner}>
                <IconSettings
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Space settings")}</span>
              </div>
            </UnstyledButton>

            {space.settings?.dictionary?.enabled === true && (
              <UnstyledButton
                component={Link}
                to={`/s/${spaceSlug}/dictionary`}
                className={clsx(
                  classes.menu,
                  location.pathname.toLowerCase() ===
                    `/s/${spaceSlug}/dictionary`.toLowerCase()
                    ? classes.activeButton
                    : "",
                )}
              >
                <div className={classes.menuItemInner}>
                  <IconBook2
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("Dictionary")}</span>
                </div>
              </UnstyledButton>
            )}

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <UnstyledButton
                className={classes.menu}
                onClick={() => {
                  handleCreatePage();
                  if (mobileSidebarOpened) {
                    toggleMobileSidebar();
                  }
                }}
              >
                <div className={classes.menuItemInner}>
                  <IconPlus
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("New page")}</span>
                </div>
              </UnstyledButton>
            )}
          </div>
        </div>

        <div className={clsx(classes.section, classes.sectionPages)}>
          <Group className={classes.pagesHeader} justify="space-between">
            <Text size="xs" fw={500} c="dimmed">
              {t("Pages")}
            </Text>

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <Group gap="xs">
                <SpaceMenu spaceId={space.id} onSpaceSettings={openSettings} />

                <Tooltip
                  label={t("Create database")}
                  withArrow
                  position="right"
                >
                  <ActionIcon
                    variant="default"
                    size={PAGE_TREE_ACTION_SIZE}
                    onClick={handleCreateDatabase}
                    disabled={createDatabaseMutation.isPending}
                    aria-label={t("Create database")}
                  >
                    <IconHexagonPlus size={PAGE_TREE_ACTION_ICON_SIZE} />
                  </ActionIcon>
                </Tooltip>

                <Tooltip label={t("Create page")} withArrow position="right">
                  <ActionIcon
                    variant="default"
                    size={PAGE_TREE_ACTION_SIZE}
                    onClick={handleCreatePage}
                    aria-label={t("Create page")}
                  >
                    <IconSquareRoundedPlus size={PAGE_TREE_ACTION_ICON_SIZE} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </Group>

          <div className={classes.pages}>
            <SpaceTree
              spaceId={space.id}
              readOnly={spaceAbility.cannot(
                SpaceCaslAction.Manage,
                SpaceCaslSubject.Page,
              )}
            />
          </div>
        </div>
      </div>

      <SpaceSettingsModal
        opened={opened}
        onClose={closeSettings}
        spaceId={space?.slug}
      />
    </>
  );
}

interface SpaceMenuProps {
  spaceId: string;
  onSpaceSettings: () => void;
}
function SpaceMenu({ spaceId, onSpaceSettings }: SpaceMenuProps) {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const [importOpened, { open: openImportModal, close: closeImportModal }] =
    useDisclosure(false);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);

  return (
    <>
      <Menu width={200} shadow="md" withArrow>
        <Menu.Target>
          <Tooltip
            label={t("Import pages & space settings")}
            withArrow
            position="top"
          >
            <ActionIcon
              variant="default"
              size={PAGE_TREE_ACTION_SIZE}
              aria-label={t("Space menu")}
            >
              <IconDots size={PAGE_TREE_ACTION_ICON_SIZE} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            onClick={openImportModal}
            leftSection={<IconArrowDown size={16} />}
          >
            {t("Import pages")}
          </Menu.Item>

          <Menu.Item
            onClick={openExportModal}
            leftSection={<IconFileExport size={16} />}
          >
            {t("Export space")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            onClick={onSpaceSettings}
            leftSection={<IconSettings size={16} />}
          >
            {t("Space settings")}
          </Menu.Item>

          <Menu.Item
            component={Link}
            to={`/s/${spaceSlug}/trash`}
            leftSection={<IconTrash size={16} />}
          >
            {t("Trash")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <PageImportModal
        spaceId={spaceId}
        open={importOpened}
        onClose={closeImportModal}
      />

      <ExportModal
        type="space"
        id={spaceId}
        open={exportOpened}
        onClose={closeExportModal}
      />
    </>
  );
}
