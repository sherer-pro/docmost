import {
  NodeApi,
  NodeRendererProps,
  Tree,
  TreeApi,
  SimpleTree,
} from "react-arborist";
import { useAtom, useSetAtom } from "jotai";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import {
  fetchAllAncestorChildren,
  useGetRootSidebarPagesQuery,
  usePageQuery,
  useUpdatePageMutation,
} from "@/features/page/queries/page-query.ts";
import {
  forwardRef,
  type ForwardedRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import classes from "@/features/page/tree/styles/tree.module.css";
import { Box, Menu, rem, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconPointFilled,
  IconFileDatabase,
  IconDotsVertical,
  IconFileDescription,
  IconFileExport,
  IconLink,
  IconPlus,
  IconTrash,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  appendNodeChildrenAtom,
  treeDataAtom,
} from "@/features/page/tree/atoms/tree-data-atom.ts";
import clsx from "clsx";
import EmojiPicker from "@/components/ui/emoji-picker.tsx";
import { useTreeMutation } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import {
  appendNodeChildren,
  buildTree,
  buildTreeWithChildren,
  insertDatabaseRowNode,
  mergeTreeNodeMetadata,
  mergeRootTrees,
  resolveActiveTreeSlug,
  setTreeNodeHasChildren,
  updateTreeNodeIcon,
} from "@/features/page/tree/utils/utils.ts";
import {
  areAllTreeNodesExpanded,
  getExpandableTreeNodeIds,
  loadTreeRecursively,
  updateTreeNodesOpenState,
} from "@/features/page/tree/utils/bulk-tree.ts";
import { shouldPublishTreeApi } from "@/features/page/tree/utils/tree-api-ref.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import {
  getPageBreadcrumbs,
  getPageById,
  getSidebarPages,
} from "@/features/page/services/page-service.ts";
import { IPage, SidebarPagesParams } from "@/features/page/types/page.types.ts";
import { queryClient } from "@/main.tsx";
import { useDisclosure, useElementSize, useMergedRef } from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { dfs } from "react-arborist/dist/module/utils";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import {
  buildDatabaseNodeUrl,
  buildPageUrl,
} from "@/features/page/page.utils.ts";
import { resolvePageDatabaseIds } from "@/features/page/page-id-adapter.ts";
import { notifications } from "@mantine/notifications";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import MovePageModal from "../../components/move-page-modal.tsx";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import { useSpaceQuery } from "@/features/space/queries/space-query.ts";
import CopyPageModal from "../../components/copy-page-modal.tsx";
import { duplicatePage } from "../../services/page-service.ts";
import { StatusIndicator } from "@/components/ui/status-indicator.tsx";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { useCreateDatabaseRowMutation } from "@/features/database/queries/database-table-query.ts";
import { useUpdateDatabaseMutation } from "@/features/database/queries/database-query.ts";
import { PAGE_QUERY_KEYS } from "@/features/page/queries/query-keys.ts";
import { invalidateSidebarTree } from "@/features/page/queries/cache-invalidation.ts";
import PageAccessModal from "../../components/page-access-modal.tsx";
import { supportsPageAccessEntity } from "@/features/page/utils/page-access-ui.ts";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { buildPageEditModeByPageId } from "@/features/user/utils/page-edit-mode.ts";
import { PageOperationMenuItems } from "../../components/page-operation-menu-items.tsx";
import {
  getOpenTreeNodesForSpace,
  isOpenStateEqual,
  openTreeNodesBySpaceAtom,
  updateOpenTreeNodesForSpace,
} from "@/features/page/tree/atoms/open-tree-nodes-atom.ts";
import {
  canExportDocument,
  hasFullSpaceAccess,
} from "@/features/space/permissions/export-access.ts";

interface SpaceTreeProps {
  spaceId: string;
  readOnly: boolean;
  onBulkStateChange?: (state: SpaceTreeBulkState) => void;
}

export interface SpaceTreeHandle {
  toggleAll: () => void;
}

export interface SpaceTreeBulkState {
  ready: boolean;
  busy: boolean;
  canToggle: boolean;
  allExpanded: boolean;
}

interface PendingBulkOpen {
  operationId: number;
  nodeIds: string[];
  hasFailures: boolean;
}

const TREE_ACTION_SIZE = 24;
const TREE_ACTION_ICON_SIZE = 16;

function SpaceTreeComponent(
  { spaceId, readOnly, onBulkStateChange }: SpaceTreeProps,
  ref: ForwardedRef<SpaceTreeHandle>,
) {
  const { t } = useTranslation();
  const { pageSlug, databaseSlug } = useParams();
  const activeTreeSlug = resolveActiveTreeSlug({ pageSlug, databaseSlug });
  const { data, setData, controllers } =
    useTreeMutation<SpaceTreeNode>(spaceId);
  const {
    data: pagesData,
    hasNextPage,
    fetchNextPage,
    isFetching,
  } = useGetRootSidebarPagesQuery({
    spaceId,
  });
  const setTreeApi = useSetAtom(treeApiAtom);
  const treeApiRef = useRef<TreeApi<SpaceTreeNode> | null>(null);
  const bulkOperationIdRef = useRef(0);
  const isBulkToggleRef = useRef(false);
  const [isTreeReady, setIsTreeReady] = useState(false);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [pendingBulkOpen, setPendingBulkOpen] =
    useState<PendingBulkOpen | null>(null);
  const [openTreeNodesBySpace, setOpenTreeNodesBySpace] = useAtom(
    openTreeNodesBySpaceAtom,
  );
  const openTreeNodes = useMemo(
    () => getOpenTreeNodesForSpace(openTreeNodesBySpace, spaceId),
    [openTreeNodesBySpace, spaceId],
  );
  const rootElement = useRef<HTMLDivElement>();
  const [isRootReady, setIsRootReady] = useState(false);
  const { ref: sizeRef, width, height } = useElementSize();
  const mergedRef = useMergedRef((element) => {
    rootElement.current = element;
    if (element && !isRootReady) {
      setIsRootReady(true);
    }
  }, sizeRef);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const { data: currentPage } = usePageQuery({
    pageId: extractPageSlugId(activeTreeSlug),
  });
  const { data: space } = useSpaceQuery(spaceId);
  const [user] = useAtom(userAtom);
  const fullSpaceAccess = hasFullSpaceAccess({
    workspaceRole: user?.role,
    spaceRole: space?.membership?.role,
  });
  const isStatusFieldEnabled = !!space?.settings?.documentFields?.status;

  useEffect(() => {
    setIsDataLoaded(false);
    bulkOperationIdRef.current += 1;
    isBulkToggleRef.current = false;
    setIsBulkBusy(false);
    setPendingBulkOpen(null);
  }, [spaceId]);

  useEffect(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, fetchNextPage, isFetching, spaceId]);

  useEffect(() => {
    if (pagesData?.pages && !hasNextPage) {
      const allItems = pagesData.pages.flatMap((page) => page.items);
      const treeData = buildTree(allItems);

      setData((prev) => {
        // fresh space; full reset
        if (prev.length === 0 || prev[0]?.spaceId !== spaceId) {
          setIsDataLoaded(true);
          return treeData;
        }

        // same space; append only missing roots
        setIsDataLoaded(true);
        return mergeRootTrees(prev, treeData);
      });
    }
  }, [pagesData, hasNextPage, spaceId]);

  useEffect(() => {
    if (!activeTreeSlug) {
      treeApiRef.current?.deselectAll();
      return;
    }

    if (!isDataLoaded || !currentPage?.id) {
      return;
    }

    let isCancelled = false;
    let selectTimer: number | undefined;

    const selectActiveNode = () => {
      selectTimer = window.setTimeout(() => {
        if (!isCancelled) {
          treeApiRef.current?.select(currentPage.id, { align: "auto" });
        }
      }, 100);
    };

    const restoreActiveNode = async () => {
      const existingNode = dfs(treeApiRef.current?.root, currentPage.id);
      if (existingNode) {
        selectActiveNode();
        return;
      }

      const ancestors = await getPageBreadcrumbs(currentPage.id);
      if (
        isCancelled ||
        spaceIdRef.current !== spaceId ||
        !ancestors ||
        ancestors.length <= 1
      ) {
        return;
      }

      let flatTreeItems = buildTree(ancestors);
      const ancestorChildren = await Promise.all(
        ancestors
          .filter((ancestor: IPage) => ancestor.id !== currentPage.id)
          .map((ancestor: IPage) =>
            fetchAllAncestorChildren({
              pageId: ancestor.id,
              spaceId: ancestor.spaceId,
              includeNodeTypes: ["page", "database", "databaseRow"],
            }),
          ),
      );

      if (isCancelled || spaceIdRef.current !== spaceId) {
        return;
      }

      ancestorChildren.forEach((children) => {
        flatTreeItems = mergeTreeNodeMetadata(flatTreeItems, children);
      });

      const ancestorsTree = buildTreeWithChildren(flatTreeItems);
      const rootChild = ancestorsTree[0];
      if (!rootChild) {
        return;
      }

      setData((currentData) =>
        appendNodeChildren(currentData, rootChild.id, rootChild.children),
      );
      selectActiveNode();
    };

    restoreActiveNode().catch((error) => {
      if (!isCancelled) {
        console.error("Failed to restore the active sidebar tree node:", error);
      }
    });

    return () => {
      isCancelled = true;
      if (selectTimer !== undefined) {
        window.clearTimeout(selectTimer);
      }
    };
  }, [activeTreeSlug, currentPage?.id, isDataLoaded, setData, spaceId]);

  // Clean up tree API on unmount
  useEffect(() => {
    return () => {
      bulkOperationIdRef.current += 1;
      setTreeApi(null);
    };
  }, [setTreeApi]);

  const filteredData = useMemo(
    () => data.filter((node) => node?.spaceId === spaceId),
    [data, spaceId],
  );

  const expandableNodeIds = useMemo(
    () => getExpandableTreeNodeIds(filteredData),
    [filteredData],
  );
  const allExpanded = useMemo(
    () => areAllTreeNodesExpanded(expandableNodeIds, openTreeNodes),
    [expandableNodeIds, openTreeNodes],
  );
  const canToggle = isDataLoaded && isTreeReady && expandableNodeIds.length > 0;

  const handleTreeRef = useCallback(
    (treeApi: TreeApi<SpaceTreeNode> | null) => {
      if (!shouldPublishTreeApi(treeApiRef.current, treeApi)) {
        return;
      }

      treeApiRef.current = treeApi;
      setIsTreeReady(true);
      setTreeApi(treeApi);
    },
    [setTreeApi],
  );

  const applyBulkOpenState = useCallback(
    (nodeIds: string[], isOpen: boolean) => {
      const treeApi = treeApiRef.current;
      if (!treeApi) {
        return;
      }

      const availableNodeIds = nodeIds.filter((nodeId) =>
        dfs(treeApi.root, nodeId),
      );
      isBulkToggleRef.current = true;

      try {
        for (const nodeId of availableNodeIds) {
          if (isOpen) {
            treeApi.open(nodeId);
          } else {
            treeApi.close(nodeId);
          }
        }

        setOpenTreeNodesBySpace((previousValue) => {
          const previousOpenState = getOpenTreeNodesForSpace(
            previousValue,
            spaceId,
          );
          const nextOpenState = updateTreeNodesOpenState(
            previousOpenState,
            availableNodeIds,
            isOpen,
          );

          if (isOpenStateEqual(previousOpenState, nextOpenState)) {
            return previousValue;
          }

          return updateOpenTreeNodesForSpace(
            previousValue,
            spaceId,
            nextOpenState,
          );
        });
      } finally {
        isBulkToggleRef.current = false;
      }
    },
    [setOpenTreeNodesBySpace, spaceId],
  );

  const collapseAll = useCallback(() => {
    bulkOperationIdRef.current += 1;
    setPendingBulkOpen(null);
    setIsBulkBusy(false);
    applyBulkOpenState(expandableNodeIds, false);
  }, [applyBulkOpenState, expandableNodeIds]);

  const expandAll = useCallback(async () => {
    if (!canToggle || isBulkBusy) {
      return;
    }

    const operationId = bulkOperationIdRef.current + 1;
    bulkOperationIdRef.current = operationId;
    setIsBulkBusy(true);

    const isCancelled = () =>
      bulkOperationIdRef.current !== operationId ||
      spaceIdRef.current !== spaceId;

    const result = await loadTreeRecursively(
      filteredData,
      (node) =>
        fetchAllAncestorChildren({
          pageId: node.id,
          spaceId: node.spaceId,
          includeNodeTypes: ["page", "database", "databaseRow"],
        }),
      {
        isCancelled,
        onChildrenLoaded: (parentId, children) => {
          if (isCancelled()) {
            return;
          }

          setData((currentTree) => {
            const treeWithChildren = appendNodeChildren(
              currentTree,
              parentId,
              children,
            );

            return children.length === 0
              ? setTreeNodeHasChildren(treeWithChildren, parentId, false)
              : treeWithChildren;
          });
        },
      },
    );

    if (result.cancelled || isCancelled()) {
      return;
    }

    if (result.expandableNodeIds.length === 0) {
      if (result.failedNodeIds.length > 0) {
        notifications.show({
          message: t("Failed to load subpages"),
          color: "red",
        });
      }

      setIsBulkBusy(false);
      return;
    }

    setPendingBulkOpen({
      operationId,
      nodeIds: result.expandableNodeIds,
      hasFailures: result.failedNodeIds.length > 0,
    });
  }, [canToggle, filteredData, isBulkBusy, setData, spaceId, t]);

  useEffect(() => {
    if (!pendingBulkOpen) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (
        bulkOperationIdRef.current !== pendingBulkOpen.operationId ||
        spaceIdRef.current !== spaceId
      ) {
        return;
      }

      applyBulkOpenState(pendingBulkOpen.nodeIds, true);

      if (pendingBulkOpen.hasFailures) {
        notifications.show({
          message: t("Failed to load subpages"),
          color: "red",
        });
      }

      setPendingBulkOpen(null);
      setIsBulkBusy(false);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [applyBulkOpenState, data, pendingBulkOpen, spaceId, t]);

  useImperativeHandle(
    ref,
    () => ({
      toggleAll: () => {
        if (!canToggle || isBulkBusy) {
          return;
        }

        if (allExpanded) {
          collapseAll();
        } else {
          void expandAll();
        }
      },
    }),
    [allExpanded, canToggle, collapseAll, expandAll, isBulkBusy],
  );

  useEffect(() => {
    onBulkStateChange?.({
      ready: isDataLoaded && isTreeReady,
      busy: isBulkBusy,
      canToggle,
      allExpanded,
    });
  }, [
    allExpanded,
    canToggle,
    isBulkBusy,
    isDataLoaded,
    isTreeReady,
    onBulkStateChange,
  ]);

  return (
    <div ref={mergedRef} className={classes.treeContainer}>
      {isDataLoaded && filteredData.length === 0 && (
        <Text size="xs" c="dimmed" py="xs" px="sm">
          {t("No pages yet")}
        </Text>
      )}
      {isRootReady && rootElement.current && (
        <Tree
          key={spaceId}
          data={filteredData}
          disableDrag={readOnly}
          disableDrop={readOnly}
          disableEdit={readOnly}
          {...controllers}
          width={width}
          height={rootElement.current.clientHeight}
          ref={handleTreeRef}
          openByDefault={false}
          disableMultiSelection={true}
          className={classes.tree}
          rowClassName={classes.row}
          rowHeight={30}
          overscanCount={10}
          dndRootElement={rootElement.current}
          onToggle={() => {
            if (isBulkToggleRef.current) {
              return;
            }

            const nextOpenState = treeApiRef.current?.openState ?? {};

            setOpenTreeNodesBySpace((previousValue) => {
              const previousOpenState = getOpenTreeNodesForSpace(
                previousValue,
                spaceId,
              );
              // We update atom only if the state has actually changed,
              // otherwise we get “self-sustaining” updates for large branches.
              if (isOpenStateEqual(previousOpenState, nextOpenState)) {
                return previousValue;
              }

              return updateOpenTreeNodesForSpace(
                previousValue,
                spaceId,
                nextOpenState,
              );
            });
          }}
          initialOpenState={openTreeNodes}
        >
          {(props) => (
            <Node
              {...props}
              isStatusFieldEnabled={isStatusFieldEnabled}
              fullSpaceAccess={fullSpaceAccess}
            />
          )}
        </Tree>
      )}
    </div>
  );
}

const SpaceTree = forwardRef(SpaceTreeComponent);

SpaceTree.displayName = "SpaceTree";

export default SpaceTree;

interface NodeProps extends NodeRendererProps<SpaceTreeNode> {
  isStatusFieldEnabled: boolean;
  fullSpaceAccess: boolean;
}

function Node({
  node,
  style,
  dragHandle,
  tree,
  isStatusFieldEnabled,
  fullSpaceAccess,
}: NodeProps) {
  const { t } = useTranslation();
  const updatePageMutation = useUpdatePageMutation();
  const updateDatabaseMutation = useUpdateDatabaseMutation(
    node.data.spaceId,
    node.data.databaseId ?? node.id,
  );
  const [, setTreeData] = useAtom(treeDataAtom);
  const [, appendChildren] = useAtom(appendNodeChildrenAtom);
  const emit = useQueryEmit();
  const { spaceSlug } = useParams();
  const navigate = useNavigate();
  const timerRef = useRef(null);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const nodeCapabilities = node.data.access?.capabilities;
  const canWriteNode =
    nodeCapabilities?.canWrite ?? !(tree.props.disableEdit as boolean);
  const canCreateChildNode =
    nodeCapabilities?.canCreateChild ?? !(tree.props.disableEdit as boolean);
  const canMoveDeleteShareNode =
    nodeCapabilities?.canMoveDeleteShare ??
    !(tree.props.disableEdit as boolean);
  const canManageAccessNode = nodeCapabilities?.canManageAccess ?? false;

  const prefetchPage = () => {
    timerRef.current = setTimeout(async () => {
      const page = await queryClient.fetchQuery({
        queryKey: PAGE_QUERY_KEYS.page(node.data.id),
        queryFn: () => getPageById({ pageId: node.data.id }),
        staleTime: 5 * 60 * 1000,
      });
      if (page?.slugId) {
        queryClient.setQueryData(PAGE_QUERY_KEYS.page(page.slugId), page);
      }
    }, 150);
  };

  const cancelPagePrefetch = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  async function handleLoadChildren(node: NodeApi<SpaceTreeNode>) {
    if (!node.data.hasChildren) return;

    // If children have already been loaded locally, a repeated request is not needed.
    // This is especially important for long lists: extra appendChildren
    // leads to constant tree updates and UI degradation.
    if (node.children && node.children.length > 0) {
      return;
    }

    try {
      const params: SidebarPagesParams = {
        pageId: node.data.id,
        spaceId: node.data.spaceId,
        includeNodeTypes: ["page", "database", "databaseRow"],
      };

      const childrenTree = await fetchAllAncestorChildren(params);

      appendChildren({
        parentId: node.data.id,
        children: childrenTree,
      });
    } catch (error) {
      console.error("Failed to fetch children:", error);
    }
  }

  const handleUpdateNodeIcon = (nodeId: string, newIcon: string | null) => {
    setTreeData((currentTree) =>
      updateTreeNodeIcon(currentTree, nodeId, newIcon),
    );
  };

  const handleEmojiIconClick = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const emitIconUpdate = (
    icon: string | null,
    parentPageId?: string | null,
  ) => {
    setTimeout(() => {
      emit({
        operation: "updateOne",
        spaceId: node.data.spaceId,
        entity: ["pages"],
        id: node.id,
        payload: {
          icon,
          parentPageId: parentPageId ?? node.data.parentPageId ?? null,
        },
      });
    }, 50);
  };

  const persistNodeIcon = async (icon: string | null) => {
    if (node.data.nodeType === "database") {
      await updateDatabaseMutation.mutateAsync({ icon });
      emitIconUpdate(icon, node.data.parentPageId);
      return;
    }

    if (node.data.nodeType !== "page" && node.data.nodeType !== "databaseRow") {
      return;
    }

    const updatedPage = await updatePageMutation.mutateAsync({
      pageId: node.id,
      icon,
    });
    emitIconUpdate(icon, updatedPage.parentPageId);
  };

  const handleEmojiSelect = (emoji: { native: string }) => {
    const previousIcon = node.data.icon ?? null;
    const nextIcon = emoji.native;

    handleUpdateNodeIcon(node.id, nextIcon);

    persistNodeIcon(nextIcon).catch(() => {
      handleUpdateNodeIcon(node.id, previousIcon);
      notifications.show({
        message: "An error occurred",
        color: "red",
      });
    });
  };

  const handleRemoveEmoji = () => {
    const previousIcon = node.data.icon ?? null;

    handleUpdateNodeIcon(node.id, null);

    persistNodeIcon(null).catch(() => {
      handleUpdateNodeIcon(node.id, previousIcon);
      notifications.show({
        message: "An error occurred",
        color: "red",
      });
    });
  };

  if (
    node.willReceiveDrop &&
    node.isClosed &&
    (node.children.length > 0 || node.data.hasChildren)
  ) {
    handleLoadChildren(node);
    setTimeout(() => {
      if (node.state.willReceiveDrop) {
        node.open();
      }
    }, 650);
  }

  /**
   * Unified routing by node discriminator:
   * - page -> /p/:slug
   * - database -> /db/:slug
   */
  const pageUrl =
    node.data.nodeType === "database"
      ? (() => {
          const resolvedIds = resolvePageDatabaseIds({
            pageId: node.data.id,
            slugId: node.data.slugId,
            databaseId: node.data.databaseId,
          });

          return buildDatabaseNodeUrl({
            spaceSlug,
            pageSlugId: resolvedIds.slugId,
            pageTitle: node.data.name,
          });
        })()
      : buildPageUrl(spaceSlug, node.data.slugId ?? "", node.data.name);

  const canOpenNode =
    node.data.nodeType === "page" ||
    node.data.nodeType === "database" ||
    node.data.nodeType === "databaseRow";

  return (
    <>
      <Box
        style={style}
        className={clsx(classes.node, node.state)}
        component={Link}
        to={pageUrl}
        // @ts-ignore
        ref={dragHandle}
        onClick={(event) => {
          if (!canOpenNode) {
            event.preventDefault();
            return;
          }

          if (node.data.nodeType === "database") {
            event.preventDefault();
            navigate(pageUrl);
          }

          if (mobileSidebarOpened) {
            toggleMobileSidebar();
          }
        }}
        onMouseEnter={
          node.data.nodeType !== "database" ? prefetchPage : undefined
        }
        onMouseLeave={
          node.data.nodeType !== "database" ? cancelPagePrefetch : undefined
        }
      >
        <PageArrow node={node} onExpandTree={() => handleLoadChildren(node)} />

        <div onClick={handleEmojiIconClick} style={{ marginRight: "4px" }}>
          <EmojiPicker
            onEmojiSelect={handleEmojiSelect}
            icon={
              node.data.icon ? (
                node.data.icon
              ) : node.data.nodeType === "database" ? (
                <IconFileDatabase size="18" />
              ) : (
                <IconFileDescription size="18" />
              )
            }
            readOnly={!canWriteNode}
            removeEmojiAction={handleRemoveEmoji}
          />
        </div>

        <span className={classes.text}>{node.data.name || t("untitled")}</span>

        {isStatusFieldEnabled && node.data.status && (
          <StatusIndicator
            status={node.data.status}
            className={classes.statusIndicator}
          />
        )}

        <div className={classes.actions}>
          <NodeMenu
            node={node}
            treeApi={tree}
            spaceId={node.data.spaceId}
            canMoveDeleteShare={canMoveDeleteShareNode}
            canManageAccess={canManageAccessNode}
            fullSpaceAccess={fullSpaceAccess}
          />

          {canCreateChildNode &&
            (node.data.nodeType === "page" ||
              node.data.nodeType === "database") && (
              <CreateNode
                node={node}
                treeApi={tree}
                onExpandTree={() => handleLoadChildren(node)}
              />
            )}
        </div>
      </Box>
    </>
  );
}

interface CreateNodeProps {
  node: NodeApi<SpaceTreeNode>;
  treeApi: TreeApi<SpaceTreeNode>;
  onExpandTree?: () => void;
}

function CreateNode({ node, treeApi, onExpandTree }: CreateNodeProps) {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const navigate = useNavigate();
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const [user, setUser] = useAtom(userAtom);
  const emit = useQueryEmit();
  const createDatabaseRowMutation = useCreateDatabaseRowMutation(
    node.data.databaseId ?? node.data.id,
  );

  async function handleCreateDatabaseRow() {
    if (createDatabaseRowMutation.isPending) {
      return;
    }

    const createdRow = await createDatabaseRowMutation.mutateAsync({
      parentPageId: node.id,
    });
    if (user) {
      setUser({
        ...user,
        settings: {
          ...user.settings,
          preferences: {
            ...user.settings?.preferences,
            pageEditModeByPageId: buildPageEditModeByPageId(
              user.settings?.preferences?.pageEditModeByPageId,
              createdRow.pageId,
              PageEditMode.Edit,
            ),
          },
        },
      });
    }

    const createdRowPage = await getPageById({ pageId: createdRow.pageId });
    queryClient.setQueryData(
      PAGE_QUERY_KEYS.page(createdRow.pageId),
      createdRowPage,
    );
    if (createdRowPage.slugId) {
      queryClient.setQueryData(
        PAGE_QUERY_KEYS.page(createdRowPage.slugId),
        createdRowPage,
      );
    }

    const treeNodeData: SpaceTreeNode = {
      id: createdRow.pageId,
      nodeType: "databaseRow",
      slugId: createdRow.slugId ?? createdRowPage.slugId,
      databaseId: createdRow.databaseId,
      name: "",
      position: "",
      spaceId: node.data.spaceId,
      parentPageId: node.id,
      icon: null,
      status: null,
      hasChildren: false,
      children: [],
    };

    const { tree: nextTreeData, index: insertionIndex } = insertDatabaseRowNode(
      treeData,
      node.id,
      treeNodeData,
    );
    setTreeData(nextTreeData);

    setTimeout(() => {
      emit({
        operation: "addTreeNode",
        spaceId: node.data.spaceId,
        payload: {
          parentId: node.id,
          index: insertionIndex,
          node: treeNodeData,
        },
      });
    }, 50);

    invalidateSidebarTree({}, { client: queryClient });

    if (node.isClosed) {
      node.open();
    }

    onExpandTree?.();

    const createdRowSlugId = createdRow.slugId ?? createdRowPage.slugId;
    if (spaceSlug && createdRowSlugId) {
      navigate(
        buildPageUrl(spaceSlug, createdRowSlugId, createdRowPage.title),
      );
    }
  }

  async function handleCreate() {
    if (node.data.nodeType === "database") {
      await handleCreateDatabaseRow();
      return;
    }

    if (node.data.hasChildren && node.children.length === 0) {
      node.toggle();
      onExpandTree?.();

      setTimeout(() => {
        treeApi?.create({ type: "internal", parentId: node.id, index: 0 });
      }, 500);
    } else {
      treeApi?.create({ type: "internal", parentId: node.id });
    }
  }

  return (
    <AccessibleActionIcon
      aria-label={
        node.data.nodeType === "database" ? t("Create row") : t("Create page")
      }
      label={
        node.data.nodeType === "database" ? t("Create row") : t("Create page")
      }
      minTargetSize={TREE_ACTION_SIZE}
      size={TREE_ACTION_SIZE}
      variant="transparent"
      c="gray"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void handleCreate();
      }}
    >
      <IconPlus
        style={{
          width: rem(TREE_ACTION_ICON_SIZE),
          height: rem(TREE_ACTION_ICON_SIZE),
        }}
        stroke={2}
      />
    </AccessibleActionIcon>
  );
}

interface NodeMenuProps {
  node: NodeApi<SpaceTreeNode>;
  treeApi: TreeApi<SpaceTreeNode>;
  spaceId: string;
  canMoveDeleteShare: boolean;
  canManageAccess: boolean;
  fullSpaceAccess: boolean;
}

function NodeMenu({
  node,
  treeApi,
  spaceId,
  canMoveDeleteShare,
  canManageAccess,
  fullSpaceAccess,
}: NodeMenuProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: 500 });
  const { spaceSlug } = useParams();
  const navigate = useNavigate();
  const { openDeleteModal } = useDeletePageModal();
  const [data, setData] = useAtom(treeDataAtom);
  const emit = useQueryEmit();
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
  const supportsAccessControl = supportsPageAccessEntity(node.data.nodeType);
  const isDatabaseNode = node.data.nodeType === "database";
  const isPageNode = node.data.nodeType === "page";
  const isDatabaseRowNode = node.data.nodeType === "databaseRow";
  const isExportableNode = isPageNode || isDatabaseNode || isDatabaseRowNode;
  const exportType = isDatabaseNode ? "database" : "page";
  const exportId = isDatabaseNode ? node.data.databaseId : node.id;
  const canExportNode =
    isExportableNode &&
    Boolean(exportId) &&
    canExportDocument({
      parentPageId: node.data.parentPageId,
      fullSpaceAccess,
    });
  const canDuplicateMoveCopyNode = isExportableNode && canMoveDeleteShare;
  const canMoveNodeToTrash = isExportableNode && canMoveDeleteShare;

  const handleCopyLink = () => {
    const resolvedDatabaseIds = resolvePageDatabaseIds({
      pageId: node.data.id,
      slugId: node.data.slugId,
      databaseId: node.data.databaseId,
    });

    const nodeUrl =
      node.data.nodeType === "database"
        ? `${getAppUrl()}${buildDatabaseNodeUrl({
            spaceSlug,
            pageSlugId: resolvedDatabaseIds.slugId,
            pageTitle: node.data.name,
          })}`
        : getAppUrl() +
          buildPageUrl(spaceSlug, node.data.slugId ?? "", node.data.name);

    clipboard.copy(nodeUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleDuplicatePage = async () => {
    try {
      const duplicatedPage = await duplicatePage({
        pageId: node.id,
      });

      // Find the index of the current node
      const parentId =
        node.parent?.id === "__REACT_ARBORIST_INTERNAL_ROOT__"
          ? null
          : node.parent?.id;
      const siblings = parentId ? node.parent.children : treeApi?.props.data;
      const currentIndex =
        siblings?.findIndex((sibling) => sibling.id === node.id) || 0;
      const newIndex = currentIndex + 1;
      const duplicatedNodeType =
        isDatabaseNode && duplicatedPage.databaseId
          ? "database"
          : isDatabaseRowNode && duplicatedPage.databaseId
            ? "databaseRow"
            : "page";

      // Add the duplicated page to the tree
      const treeNodeData: SpaceTreeNode = {
        id: duplicatedPage.id,
        nodeType: duplicatedNodeType,
        slugId: duplicatedPage.slugId,
        databaseId: duplicatedPage.databaseId ?? null,
        name: duplicatedPage.title,
        position: duplicatedPage.position,
        spaceId: duplicatedPage.spaceId,
        parentPageId: duplicatedPage.parentPageId,
        icon: duplicatedPage.icon,
        status: duplicatedPage.customFields?.status,
        hasChildren: duplicatedPage.hasChildren,
        children: [],
      };

      // Update local tree
      const simpleTree = new SimpleTree(data);
      simpleTree.create({
        parentId,
        index: newIndex,
        data: treeNodeData,
      });
      setData(simpleTree.data);

      // Emit socket event
      setTimeout(() => {
        emit({
          operation: "addTreeNode",
          spaceId: spaceId,
          payload: {
            parentId,
            index: newIndex,
            node: treeNodeData,
          },
        });
      }, 50);

      notifications.show({
        message: t("Page duplicated successfully"),
      });
    } catch (err) {
      notifications.show({
        message: err.response?.data.message || "An error occurred",
        color: "red",
      });
    }
  };

  return (
    <>
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <AccessibleActionIcon
            aria-label={t("Page actions")}
            label={t("Page actions")}
            minTargetSize={TREE_ACTION_SIZE}
            size={TREE_ACTION_SIZE}
            variant="transparent"
            c="gray"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <IconDotsVertical
              style={{
                width: rem(TREE_ACTION_ICON_SIZE),
                height: rem(TREE_ACTION_ICON_SIZE),
              }}
              stroke={2}
            />
          </AccessibleActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconLink size={16} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopyLink();
            }}
          >
            {t("Copy link")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconFileExport size={16} />}
            disabled={!canExportNode}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openExportModal();
            }}
          >
            {t("Export page")}
          </Menu.Item>

          {canDuplicateMoveCopyNode && (
            <>
              <PageOperationMenuItems
                onDuplicate={() => void handleDuplicatePage()}
                onMove={openMovePageModal}
                onCopyToSpace={openCopyPageModal}
              />
            </>
          )}

          {supportsAccessControl && canManageAccess && (
            <Menu.Item
              leftSection={<IconUsersGroup size={16} />}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openAccessModal();
              }}
            >
              {t("page.access.menu", { keySeparator: false })}
            </Menu.Item>
          )}

          {canMoveNodeToTrash && (
            <>
              <Menu.Divider />
              <Menu.Item
                c="red"
                leftSection={<IconTrash size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openDeleteModal({ onConfirm: () => treeApi?.delete(node) });
                }}
              >
                {t("Move to trash")}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

      {isExportableNode && (
        <>
          <MovePageModal
            pageId={node.id}
            slugId={node.data.slugId ?? ""}
            currentSpaceSlug={spaceSlug}
            nodeType={node.data.nodeType}
            title={node.data.name}
            onClose={closeMoveSpaceModal}
            open={movePageModalOpened}
          />

          <CopyPageModal
            pageId={node.id}
            currentSpaceSlug={spaceSlug}
            nodeType={node.data.nodeType}
            onClose={closeCopySpaceModal}
            open={copyPageModalOpened}
          />
        </>
      )}

      {canExportNode && (
        <>
          <ExportModal
            type={exportType}
            id={exportId as string}
            open={exportOpened}
            onClose={closeExportModal}
          />
        </>
      )}

      {supportsAccessControl && (
        <PageAccessModal
          pageId={node.id}
          open={accessModalOpened}
          onClose={closeAccessModal}
        />
      )}
    </>
  );
}

interface PageArrowProps {
  node: NodeApi<SpaceTreeNode>;
  onExpandTree?: () => void;
}

function PageArrow({ node, onExpandTree }: PageArrowProps) {
  const { t } = useTranslation();
  const hasExpandableChildren =
    (node.children?.length ?? 0) > 0 || !!node.data.hasChildren;

  useEffect(() => {
    /**
     * Whenever a node is expanded (by clicking on the chevron, hotkeys,
     * DnD hover-open or openState recovery) initiate
     * lazy additional loading of children through a single handler.
     */
    if (node.isOpen) {
      onExpandTree?.();
    }
  }, [node.isOpen, onExpandTree]);

  return (
    <AccessibleActionIcon
      aria-label={
        hasExpandableChildren
          ? node.isOpen
            ? t("Collapse")
            : t("Expand")
          : t("Page")
      }
      label={
        hasExpandableChildren
          ? node.isOpen
            ? t("Collapse")
            : t("Expand")
          : t("Page")
      }
      size={20}
      minTargetSize={20}
      variant="subtle"
      c="gray"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        node.toggle();
        onExpandTree();
      }}
    >
      {node.isInternal ? (
        node.children && (node.children.length > 0 || node.data.hasChildren) ? (
          node.isOpen ? (
            <IconChevronDown stroke={2} size={16} />
          ) : (
            <IconChevronRight stroke={2} size={16} />
          )
        ) : (
          <IconPointFilled size={8} />
        )
      ) : null}
    </AccessibleActionIcon>
  );
}
