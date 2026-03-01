import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFileDatabase,
  IconFileExport,
  IconHome,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import classes from "./space-sidebar.module.css";
import React from "react";
import { useAtom } from "jotai";
import { atom } from "jotai";
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
import { useGetDatabasesBySpaceQuery } from "@/features/database/queries/database-query.ts";
import { useCreateDatabaseMutation } from "@/features/database/queries/database-query.ts";
import {
  useCreateDatabaseRowMutation,
  useDatabaseRowsQuery,
  useDeleteDatabaseRowMutation,
} from "@/features/database/queries/database-table-query.ts";
import { IDatabase } from "@/features/database/types/database.types";
import { notifications } from "@mantine/notifications";
import { StatusIndicator } from "@/components/ui/status-indicator.tsx";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { MoveHandler, NodeRendererProps, SimpleTree, Tree, TreeApi } from "react-arborist";
import { useMovePageMutation, updateCacheOnMovePage } from "@/features/page/queries/page-query.ts";
import { IMovePage } from "@/features/page/types/page.types.ts";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import { queryClient } from "@/main.tsx";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { OpenMap } from "react-arborist/dist/main/state/open-slice";
import treeClasses from "@/features/page/tree/styles/tree.module.css";

const openDatabaseRowsTreeNodesAtom = atom<Record<string, OpenMap>>({});

/**
 * Выполняет поверхностную проверку open-state дерева,
 * чтобы избежать лишних перерисовок при одинаковом наборе раскрытых узлов.
 */
function isOpenStateEqual(prev: OpenMap, next: OpenMap) {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length !== nextKeys.length) {
    return false;
  }

  return prevKeys.every((key) => prev[key] === next[key]);
}

export function SpaceSidebar() {
  const { t } = useTranslation();
  const [tree] = useAtom(treeApiAtom);
  const location = useLocation();
  const [opened, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const [currentUser, setCurrentUser] = useAtom(currentUserAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const navigate = useNavigate();

  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const isStatusFieldEnabled = !!space?.settings?.documentFields?.status;

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);
  const { data: databases = [] } = useGetDatabasesBySpaceQuery(space?.id);
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
        name: t("Untitled database"),
      });

      if (
        currentUser?.user?.settings?.preferences?.pageEditMode !==
        PageEditMode.Edit
      ) {
        setCurrentUser({
          ...currentUser,
          user: {
            ...currentUser.user,
            settings: {
              ...currentUser.user.settings,
              preferences: {
                ...currentUser.user.settings.preferences,
                pageEditMode: PageEditMode.Edit,
              },
            },
          },
        });
      }

      notifications.show({ message: t("Database created") });
      navigate(`/s/${spaceSlug}/databases/${createdDatabase.id}`);
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

                <Tooltip label={t("Create page")} withArrow position="right">
                  <ActionIcon
                    variant="default"
                    size={18}
                    onClick={handleCreatePage}
                    aria-label={t("Create page")}
                  >
                    <IconPlus />
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

          <Group className={classes.pagesHeader} justify="space-between">
            <Text size="xs" fw={500} c="dimmed">
              {t("Databases")}
            </Text>

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <Tooltip label={t("Create database")} withArrow position="right">
                <ActionIcon
                  variant="default"
                  size={18}
                  onClick={handleCreateDatabase}
                  disabled={createDatabaseMutation.isPending}
                  aria-label={t("Create database")}
                >
                  <IconPlus />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>

          <div className={clsx(classes.pages, classes.databaseList)}>
            {databases.map((database) => (
              <div key={database.id}>
                <UnstyledButton
                  component={Link}
                  to={`/s/${spaceSlug}/databases/${database.id}`}
                  className={clsx(
                    classes.menu,
                    location.pathname.toLowerCase() ===
                      `/s/${spaceSlug}/databases/${database.id}`.toLowerCase()
                      ? classes.activeButton
                      : "",
                  )}
                >
                  <div className={classes.menuItemInner}>
                    <IconFileDatabase
                      size={18}
                      className={classes.menuItemIcon}
                      stroke={2}
                    />
                    <span className={classes.menuItemLabel}>
                      {database.name}
                    </span>
                    {isStatusFieldEnabled && database.status && (
                      <StatusIndicator
                        status={database.status}
                        className={classes.statusIndicator}
                      />
                    )}
                  </div>
                </UnstyledButton>
                <DatabaseRowsTree
                  database={database}
                  spaceSlug={spaceSlug || ""}
                  isStatusFieldEnabled={isStatusFieldEnabled}
                />
              </div>
            ))}
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

interface DatabaseRowsTreeProps {
  database: IDatabase;
  spaceSlug: string;
  isStatusFieldEnabled: boolean;
}

interface DatabaseRowTreeNode {
  id: string;
  pageId: string;
  parentPageId: string | null;
  title: string;
  name: string;
  slugId: string | null;
  status: string | null;
  position: string;
  children: DatabaseRowTreeNode[];
}

/**
 * Преобразует плоский список rows в иерархию для react-arborist.
 *
 * В дереве показываем только строки текущей базы:
 * - если parentPageId указывает на страницу базы, нода попадает в корень дерева;
 * - если parentPageId указывает на другую строку этой же базы, строим вложенность.
 */
function buildDatabaseRowsTree(
  rows: ReturnType<typeof useDatabaseRowsQuery>["data"],
  databasePageId?: string | null,
): DatabaseRowTreeNode[] {
  if (!rows?.length) {
    return [];
  }

  const map = new Map<string, DatabaseRowTreeNode>();
  const roots: DatabaseRowTreeNode[] = [];

  for (const row of rows) {
    map.set(row.pageId, {
      id: row.pageId,
      pageId: row.pageId,
      parentPageId: row.page?.parentPageId ?? null,
      title: row.page?.title || row.pageTitle || "Untitled",
      name: row.page?.title || row.pageTitle || "Untitled",
      slugId: row.page?.slugId ?? null,
      status: row.page?.customFields?.status ?? null,
      position: row.page?.position ?? "",
      children: [],
    });
  }

  for (const node of map.values()) {
    const parentId = node.parentPageId;

    if (!parentId || parentId === databasePageId) {
      roots.push(node);
      continue;
    }

    const parentNode = map.get(parentId);
    if (!parentNode) {
      roots.push(node);
      continue;
    }

    parentNode.children.push(node);
  }

  const sortByPositionDesc = (items: DatabaseRowTreeNode[]) => {
    items.sort((a, b) => b.position.localeCompare(a.position));
    for (const item of items) {
      sortByPositionDesc(item.children);
    }
  };

  sortByPositionDesc(roots);

  return roots;
}

function DatabaseRowsTree({
  database,
  spaceSlug,
  isStatusFieldEnabled,
}: DatabaseRowsTreeProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const emit = useQueryEmit();
  const { data: rows = [] } = useDatabaseRowsQuery(database.id);
  const createRowMutation = useCreateDatabaseRowMutation(database.id);
  const deleteRowMutation = useDeleteDatabaseRowMutation(database.id);
  const movePageMutation = useMovePageMutation();
  const rowsTreeApiRef = React.useRef<TreeApi<DatabaseRowTreeNode> | null>(null);
  const [openRowsTreeNodes, setOpenRowsTreeNodes] = useAtom(
    openDatabaseRowsTreeNodesAtom,
  );

  const treeData = React.useMemo(
    () => buildDatabaseRowsTree(rows, database.pageId),
    [rows, database.pageId],
  );

  const handleMove: MoveHandler<DatabaseRowTreeNode> = async ({
    dragIds,
    dragNodes,
    parentId,
    index,
  }) => {
    const draggedNodeId = dragIds[0];
    const draggedNode = dragNodes[0];

    if (!draggedNodeId || !draggedNode) {
      return;
    }

    const allowedParentIds = new Set<string>(rows.map((row) => row.pageId));
    if (database.pageId) {
      allowedParentIds.add(database.pageId);
    }

    const normalizedParentId = parentId ?? database.pageId ?? null;

    /**
     * Защита от некорректных перемещений:
     * - корень дерева маппим на pageId самой базы;
     * - запрещаем перенос в родителя, который не принадлежит строкам/базе.
     */
    if (!normalizedParentId || !allowedParentIds.has(normalizedParentId)) {
      return;
    }

    const tree = new SimpleTree<DatabaseRowTreeNode>(treeData);
    tree.move({ id: draggedNodeId, parentId, index });

    const newDragIndex = tree.find(draggedNodeId)?.childIndex ?? index;
    const currentTreeData = parentId ? tree.find(parentId).children : tree.data;

    const afterPosition =
      // @ts-ignore Нормализуем доступ к данным для root/child коллекций.
      currentTreeData[newDragIndex - 1]?.position ||
      // @ts-ignore Нормализуем доступ к данным для root/child коллекций.
      currentTreeData[index - 1]?.data?.position ||
      null;

    const beforePosition =
      // @ts-ignore Нормализуем доступ к данным для root/child коллекций.
      currentTreeData[newDragIndex + 1]?.position ||
      // @ts-ignore Нормализуем доступ к данным для root/child коллекций.
      currentTreeData[index + 1]?.data?.position ||
      null;

    const newPosition =
      afterPosition && beforePosition && afterPosition === beforePosition
        ? generateJitteredKeyBetween(afterPosition, null)
        : generateJitteredKeyBetween(afterPosition, beforePosition);

    const oldParentId = draggedNode.data.parentPageId ?? null;

    const payload: IMovePage = {
      pageId: draggedNodeId,
      position: newPosition,
      parentPageId: normalizedParentId,
    };

    try {
      await movePageMutation.mutateAsync(payload);

      /**
       * Синхронизация cache для sidebar-дерева страниц.
       *
       * Строки базы хранятся как pages, поэтому используем ту же утилиту,
       * что и для обычного tree move.
       */
      updateCacheOnMovePage(
        database.spaceId,
        draggedNodeId,
        oldParentId,
        normalizedParentId,
        {
          id: draggedNode.data.pageId,
          slugId: draggedNode.data.slugId,
          title: draggedNode.data.title,
          position: newPosition,
          spaceId: database.spaceId,
          parentPageId: normalizedParentId,
        },
      );

      /**
       * Отдельно актуализируем кэш rows конкретной базы,
       * чтобы дерево строк в sidebar обновилось без refetch.
       */
      queryClient.setQueryData(
        ["database", database.id, "rows"],
        (oldRows: any[] | undefined) => {
          if (!oldRows) {
            return oldRows;
          }

          const updated = oldRows.map((row) => {
            if (row.pageId !== draggedNodeId) {
              return row;
            }

            return {
              ...row,
              page: {
                ...row.page,
                parentPageId: normalizedParentId,
                position: newPosition,
              },
            };
          });

          return updated;
        },
      );

      setTimeout(() => {
        emit({
          operation: "moveTreeNode",
          spaceId: database.spaceId,
          payload: {
            id: draggedNodeId,
            parentId,
            oldParentId,
            index,
            position: newPosition,
            node: {
              id: draggedNode.data.pageId,
              slugId: draggedNode.data.slugId,
              name: draggedNode.data.title,
              nodeType: "databaseRow",
              databaseId: database.id,
              hasChildren: Boolean(draggedNode.children?.length),
              position: newPosition,
              spaceId: database.spaceId,
              parentPageId: normalizedParentId,
              children: [],
            },
          },
        });
      }, 50);
    } catch (error) {
      console.error("Failed to move database row", error);
    }
  };

  const renderNode = ({ node, style }: NodeRendererProps<DatabaseRowTreeNode>) => {
    const rowLink = `/s/${spaceSlug}/p/${node.data.slugId || node.data.pageId}`;
    const isActiveRow =
      location.pathname.toLowerCase() === rowLink.toLowerCase();
    const isExpandable = node.children.length > 0;

    return (
      <Link
        style={style}
        to={rowLink}
        className={clsx(
          treeClasses.node,
          node.state,
          classes.databaseRowNode,
          isActiveRow ? classes.activeRowTreeItem : "",
        )}
      >
        <ActionIcon
          size={20}
          variant="subtle"
          c="gray"
          className={classes.rowTreeArrow}
          aria-label={node.isOpen ? t("Collapse") : t("Expand")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isExpandable) {
              node.toggle();
            }
          }}
        >
          {isExpandable &&
            (node.isOpen ? (
              <IconChevronDown stroke={2} size={18} />
            ) : (
              <IconChevronRight stroke={2} size={18} />
            ))}
        </ActionIcon>

        <div
          className={clsx(classes.menuItemInner, classes.databaseRowLink, {
            [classes.activeButton]: isActiveRow,
          })}
        >
          <span className={clsx(classes.menuItemLabel, treeClasses.text)}>
            {node.data.title}
          </span>
          {isStatusFieldEnabled && node.data.status && (
            <StatusIndicator
              status={node.data.status}
              className={classes.statusIndicator}
            />
          )}
        </div>

        <div className={treeClasses.actions}>
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <ActionIcon
                variant="transparent"
                c="gray"
                className={classes.rowTreeMenuButton}
                aria-label={t("Row actions")}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <IconDots size={20} stroke={2} />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconPlus size={14} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  createRowMutation.mutate({ parentPageId: node.data.pageId });
                }}
              >
                {t("New row")}
              </Menu.Item>

              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteRowMutation.mutate(node.data.pageId);
                }}
              >
                {t("Delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </Link>
    );
  };

  return (
    <div>
      <Group gap={4} wrap="nowrap">
        <Button
          variant="subtle"
          size="compact-xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => createRowMutation.mutate({ parentPageId: database.pageId })}
        >
          {t("New row")}
        </Button>
      </Group>

      <Tree<DatabaseRowTreeNode>
        data={treeData}
        idAccessor="id"
        childrenAccessor="children"
        disableEdit
        disableDrag={false}
        disableDrop={(args) => {
          /**
           * Ещё одна линия защиты для DnD:
           * разрешаем drop только в корень текущей базы или в строки этой же базы.
           */
          if (!args.parentNode) {
            return false;
          }

          const parentId = args.parentNode.data.pageId;
          return !rows.some((row) => row.pageId === parentId);
        }}
        rowHeight={30}
        className={treeClasses.tree}
        rowClassName={treeClasses.row}
        indent={16}
        paddingTop={4}
        paddingBottom={4}
        width="100%"
        height={Math.min(240, Math.max(40, treeData.length * 34 + 8))}
        onMove={handleMove}
        ref={(ref) => {
          rowsTreeApiRef.current = ref;
        }}
        onToggle={() => {
          setOpenRowsTreeNodes((prev) => {
            const currentState = prev[database.id] ?? {};
            const nextState = rowsTreeApiRef.current?.openState ?? {};

            if (isOpenStateEqual(currentState, nextState)) {
              return prev;
            }

            return {
              ...prev,
              [database.id]: nextState,
            };
          });
        }}
        initialOpenState={openRowsTreeNodes[database.id] ?? {}}
      >
        {renderNode}
      </Tree>
    </div>
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
              size={18}
              aria-label={t("Space menu")}
            >
              <IconDots />
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
