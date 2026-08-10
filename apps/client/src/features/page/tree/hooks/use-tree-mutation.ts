import { useMemo } from "react";
import { useDragDropManager } from "react-dnd";
import {
  CreateHandler,
  DeleteHandler,
  MoveHandler,
  NodeApi,
  RenameHandler,
  SimpleTree,
} from "react-arborist";
import { useAtom } from "jotai";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { IMovePage, IPage } from "@/features/page/types/page.types.ts";
import { useNavigate, useParams } from "react-router-dom";
import {
  useCreatePageMutation,
  useRemovePageMutation,
  useMovePageMutation,
  useUpdatePageMutation,
  updateCacheOnMovePage,
} from "@/features/page/queries/page-query.ts";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import {
  dropTreeNode,
  isTreeExternalDropResult,
  mapPageToTreeNode,
  resolveActiveTreeSlug,
  treeNodeContainsRouteSlug,
} from "@/features/page/tree/utils";
import { getSpaceUrl } from "@/lib/config.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { buildPageEditModeByPageId } from "@/features/user/utils/page-edit-mode.ts";

function applyConfirmedTreeMove(
  currentData: SpaceTreeNode[],
  draggedNodeId: string,
  parentId: string | null,
  index: number,
  position: string,
): SpaceTreeNode[] {
  const confirmedTree = new SimpleTree<SpaceTreeNode>(
    structuredClone(currentData),
  );
  const draggedNode = confirmedTree.find(draggedNodeId);
  const previousParent = draggedNode?.parent;

  confirmedTree.move({ id: draggedNodeId, parentId, index });
  confirmedTree.update({
    id: draggedNodeId,
    changes: { position, parentPageId: parentId } as any,
  });

  if (
    previousParent &&
    previousParent.id !== parentId &&
    previousParent.id !== "ROOT" &&
    previousParent.children.length === 0
  ) {
    confirmedTree.update({
      id: previousParent.id,
      changes: { hasChildren: false } as any,
    });
  }

  return confirmedTree.data;
}

export function useTreeMutation<T>(spaceId: string) {
  const dndManager = useDragDropManager();
  const [data, setData] = useAtom(treeDataAtom);
  const tree = useMemo(
    () => new SimpleTree<SpaceTreeNode>(structuredClone(data)),
    [data],
  );
  const createPageMutation = useCreatePageMutation({ syncTree: false });
  const updatePageMutation = useUpdatePageMutation();
  const removePageMutation = useRemovePageMutation();
  const movePageMutation = useMovePageMutation();
  const navigate = useNavigate();
  const { spaceSlug, pageSlug, databaseSlug } = useParams();
  const activeTreeSlug = resolveActiveTreeSlug({ pageSlug, databaseSlug });
  const emit = useQueryEmit();
  const [user, setUser] = useAtom(userAtom);

  const onCreate: CreateHandler<T> = async ({ parentId, index, type }) => {
    const payload: { spaceId: string; parentPageId?: string } = {
      spaceId: spaceId,
    };
    if (parentId) {
      payload.parentPageId = parentId;
    }

    let createdPage: IPage;
    try {
      createdPage = await createPageMutation.mutateAsync(payload);
    } catch (err) {
      throw new Error("Failed to create page");
    }

    const data = mapPageToTreeNode(createdPage);

    let lastIndex: number;
    if (parentId === null) {
      lastIndex = tree.data.length;
    } else {
      lastIndex = tree.find(parentId).children.length;
    }
    // to place the newly created node at the bottom
    index = lastIndex;

    tree.create({ parentId, index, data });
    setData(tree.data);

    if (user) {
      setUser({
        ...user,
        settings: {
          ...user.settings,
          preferences: {
            ...user.settings?.preferences,
            pageEditModeByPageId: buildPageEditModeByPageId(
              user.settings?.preferences?.pageEditModeByPageId,
              createdPage.id,
              PageEditMode.Edit,
            ),
          },
        },
      });
    }

    setTimeout(() => {
      emit({
        operation: "addTreeNode",
        spaceId: spaceId,
        payload: {
          parentId,
          index,
          node: data,
        },
      });
    }, 50);

    const pageUrl = buildPageUrl(
      spaceSlug,
      createdPage.slugId,
      createdPage.title,
    );
    navigate(pageUrl);
    return data;
  };

  const onMove: MoveHandler<T> = async (args: {
    dragIds: string[];
    dragNodes: NodeApi<T>[];
    parentId: string | null;
    parentNode: NodeApi<T> | null;
    index: number;
  }) => {
    if (isTreeExternalDropResult(dndManager.getMonitor().getDropResult())) {
      return;
    }

    const draggedNodeId = args.dragIds[0];

    tree.move({
      id: draggedNodeId,
      parentId: args.parentId,
      index: args.index,
    });

    const newDragIndex = tree.find(draggedNodeId)?.childIndex;

    const currentTreeData = args.parentId
      ? tree.find(args.parentId).children
      : tree.data;

    // if there is a parentId, tree.find(args.parentId).children returns a SimpleNode array
    // we have to access the node differently via currentTreeData[args.index]?.data?.position
    // this makes it possible to correctly sort children of a parent node that is not the root

    const afterPosition =
      // @ts-ignore
      currentTreeData[newDragIndex - 1]?.position ||
      // @ts-ignore
      currentTreeData[args.index - 1]?.data?.position ||
      null;

    const beforePosition =
      // @ts-ignore
      currentTreeData[newDragIndex + 1]?.position ||
      // @ts-ignore
      currentTreeData[args.index + 1]?.data?.position ||
      null;

    let newPosition: string;

    if (afterPosition && beforePosition && afterPosition === beforePosition) {
      // if after is equal to before, put it next to the after node
      newPosition = generateJitteredKeyBetween(afterPosition, null);
    } else {
      // if both are null then, it is the first index
      newPosition = generateJitteredKeyBetween(afterPosition, beforePosition);
    }

    const payload: IMovePage = {
      pageId: draggedNodeId,
      position: newPosition,
      parentPageId: args.parentId,
    };

    const draggedNode = args.dragNodes[0];
    const nodeData = draggedNode.data as SpaceTreeNode;
    const oldParentId = nodeData.parentPageId ?? null;
    const pageData = {
      id: nodeData.id,
      nodeType: nodeData.nodeType,
      slugId: nodeData.slugId,
      databaseId: nodeData.databaseId ?? null,
      title: nodeData.name,
      icon: nodeData.icon,
      position: newPosition,
      spaceId: nodeData.spaceId,
      parentPageId: args.parentId,
      hasChildren: nodeData.hasChildren,
    };

    const movedNodePayload: SpaceTreeNode = {
      ...nodeData,
      name: nodeData.name,
      position: newPosition,
      parentPageId: args.parentId,
    };

    try {
      await movePageMutation.mutateAsync(payload);

      setData((currentData) =>
        applyConfirmedTreeMove(
          currentData,
          draggedNodeId,
          args.parentId,
          args.index,
          newPosition,
        ),
      );

      updateCacheOnMovePage(
        spaceId,
        draggedNodeId,
        oldParentId,
        args.parentId,
        pageData,
      );

      setTimeout(() => {
        emit({
          operation: "moveTreeNode",
          spaceId: spaceId,
          payload: {
            id: draggedNodeId,
            parentId: args.parentId,
            oldParentId,
            index: args.index,
            position: newPosition,
            node: movedNodePayload,
          },
        });
      }, 50);
    } catch (error) {
      setData((currentData) => structuredClone(currentData));
      console.error("Error moving page:", error);
    }
  };

  const onRename: RenameHandler<T> = ({ name, id }) => {
    tree.update({ id, changes: { name } as any });
    setData(tree.data);

    try {
      updatePageMutation.mutateAsync({ pageId: id, title: name });
    } catch (error) {
      console.error("Error updating page title:", error);
    }
  };

  const onDelete: DeleteHandler<T> = async (args: { ids: string[] }) => {
    try {
      await removePageMutation.mutateAsync(args.ids[0]);

      const node = tree.find(args.ids[0]);
      if (!node) {
        return;
      }

      setData(dropTreeNode(data, args.ids[0]));

      if (treeNodeContainsRouteSlug(node.data, activeTreeSlug)) {
        navigate(getSpaceUrl(spaceSlug), { replace: true });
      }

      setTimeout(() => {
        emit({
          operation: "deleteTreeNode",
          spaceId: spaceId,
          payload: { node: node.data },
        });
      }, 50);
    } catch (error) {
      console.error("Failed to delete page:", error);
    }
  };

  const controllers = { onMove, onRename, onCreate, onDelete };
  return { data, setData, controllers } as const;
}
