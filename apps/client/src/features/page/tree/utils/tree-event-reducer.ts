import type {
  IPage,
  ISidebarNode,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import type {
  SpaceTreeNode,
  SpaceTreeNodeType,
} from "@/features/page/tree/types.ts";
import {
  dropTreeNode,
  insertOrUpdateTreeNode,
  mapPageToTreeNode,
  setTreeNodeHasChildren,
} from "@/features/page/tree/utils/utils.ts";
import { SimpleTree } from "react-arborist";

type TreeEventNodeInput = Partial<IPage> &
  Partial<ISidebarNode> & {
    id?: string;
    nodeType?: SpaceTreeNodeType;
    title?: string;
    name?: string;
  };

function getTreeNode(treeItems: SpaceTreeNode[], id: string) {
  return new SimpleTree<SpaceTreeNode>(treeItems).find(id)?.data;
}

function getSiblingInsertionIndex(
  treeItems: SpaceTreeNode[],
  parentPageId: string | null,
  position?: string,
): number | undefined {
  if (!position) {
    return undefined;
  }

  const treeApi = new SimpleTree<SpaceTreeNode>(treeItems);
  const siblings = parentPageId
    ? (treeApi.find(parentPageId)?.children.map((node) => node.data) ?? [])
    : treeApi.data;

  const nextIndex = siblings.findIndex((node) => node.position > position);
  return nextIndex === -1 ? siblings.length : nextIndex;
}

function eventNodeToTreeNode(input: TreeEventNodeInput): SpaceTreeNode | null {
  if (!input.id || !input.spaceId) {
    return null;
  }

  return mapPageToTreeNode(
    {
      id: input.id,
      title: input.title ?? input.name ?? "",
      icon: input.icon ?? null,
      position: input.position ?? "",
      hasChildren: Boolean(input.hasChildren),
      spaceId: input.spaceId,
      parentPageId: input.parentPageId ?? null,
      slugId: input.slugId ?? null,
      databaseId: input.databaseId ?? null,
      customFields: input.customFields,
      access: input.access,
    },
    {
      nodeType: input.nodeType ?? "page",
    },
  );
}

function eventNodeToChanges(input: TreeEventNodeInput): Partial<SpaceTreeNode> {
  const status =
    input.customFields && "status" in input.customFields
      ? (input.customFields.status as PageCustomFieldStatus | null | undefined)
      : undefined;

  return {
    ...(input.nodeType !== undefined ? { nodeType: input.nodeType } : {}),
    ...(input.slugId !== undefined ? { slugId: input.slugId } : {}),
    ...(input.databaseId !== undefined ? { databaseId: input.databaseId } : {}),
    ...(input.title !== undefined ? { name: input.title } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.spaceId !== undefined ? { spaceId: input.spaceId } : {}),
    ...(input.parentPageId !== undefined
      ? { parentPageId: input.parentPageId ?? null }
      : {}),
    ...(input.hasChildren !== undefined
      ? { hasChildren: Boolean(input.hasChildren) }
      : {}),
    ...(input.access !== undefined ? { access: input.access } : {}),
  };
}

function clearParentHasChildrenIfEmpty(
  treeItems: SpaceTreeNode[],
  parentPageId: string | null | undefined,
): SpaceTreeNode[] {
  if (!parentPageId) {
    return treeItems;
  }

  const parent = getTreeNode(treeItems, parentPageId);
  if (!parent || parent.children.length > 0) {
    return treeItems;
  }

  return setTreeNodeHasChildren(treeItems, parentPageId, false);
}

export function applyAddTreeNode(
  treeItems: SpaceTreeNode[],
  nodeInput: TreeEventNodeInput,
): SpaceTreeNode[] {
  const node = eventNodeToTreeNode(nodeInput);
  if (!node) {
    return treeItems;
  }

  const index = getSiblingInsertionIndex(
    treeItems,
    node.parentPageId,
    node.position,
  );

  return insertOrUpdateTreeNode(treeItems, node, index).tree;
}

export function applyUpdateOneTreeNode(
  treeItems: SpaceTreeNode[],
  id: string,
  changesInput: TreeEventNodeInput,
): SpaceTreeNode[] {
  const changes = eventNodeToChanges(changesInput);
  if (Object.keys(changes).length === 0) {
    return treeItems;
  }

  const treeApi = new SimpleTree<SpaceTreeNode>(treeItems);
  if (!treeApi.find(id)) {
    return treeItems;
  }

  treeApi.update({
    id,
    changes,
  });

  return treeApi.data;
}

export function applyMoveTreeNode(
  treeItems: SpaceTreeNode[],
  input: {
    id: string;
    oldParentId?: string | null;
    parentId: string | null;
    node?: TreeEventNodeInput;
  },
): SpaceTreeNode[] {
  const currentNode = getTreeNode(treeItems, input.id);
  if (!currentNode) {
    return input.node
      ? applyAddTreeNode(treeItems, {
          ...input.node,
          parentPageId: input.parentId,
        })
      : treeItems;
  }

  const nextNode: SpaceTreeNode = {
    ...currentNode,
    ...eventNodeToChanges(input.node ?? {}),
    parentPageId: input.parentId,
    children: currentNode.children,
  };

  const treeWithoutNode = clearParentHasChildrenIfEmpty(
    dropTreeNode(treeItems, input.id),
    input.oldParentId ?? currentNode.parentPageId,
  );
  const index = getSiblingInsertionIndex(
    treeWithoutNode,
    input.parentId,
    nextNode.position,
  );

  return insertOrUpdateTreeNode(treeWithoutNode, nextNode, index).tree;
}

export function applyDeleteTreeNode(
  treeItems: SpaceTreeNode[],
  nodeId: string,
): SpaceTreeNode[] {
  const currentNode = getTreeNode(treeItems, nodeId);
  if (!currentNode) {
    return treeItems;
  }

  return clearParentHasChildrenIfEmpty(
    dropTreeNode(treeItems, nodeId),
    currentNode.parentPageId,
  );
}
