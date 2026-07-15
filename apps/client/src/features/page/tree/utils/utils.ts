import type { IDatabase } from "@/features/database/types/database.types.ts";
import type {
  IPage,
  ISidebarNode,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { SimpleTree } from "react-arborist";

type TreePageSource = Pick<
  IPage,
  | "id"
  | "title"
  | "icon"
  | "position"
  | "hasChildren"
  | "spaceId"
  | "parentPageId"
> &
  Partial<Pick<IPage, "slugId" | "customFields" | "access" | "databaseId">>;

type TreeDatabaseSource = Pick<
  IDatabase,
  "id" | "spaceId" | "name" | "icon" | "pageId"
> &
  Partial<Pick<IDatabase, "status">>;

export function sortPositionKeys(keys: any[]) {
  return keys.sort((a, b) => {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
    return 0;
  });
}

export function mapPageToTreeNode(
  page: TreePageSource,
  overrides: Partial<SpaceTreeNode> = {},
): SpaceTreeNode {
  return {
    id: page.id,
    nodeType: "page",
    slugId: page.slugId ?? null,
    databaseId: page.databaseId ?? null,
    name: page.title ?? "",
    icon: page.icon ?? null,
    status: page.customFields?.status ?? null,
    position: page.position ?? "",
    hasChildren: Boolean(page.hasChildren),
    spaceId: page.spaceId,
    parentPageId: page.parentPageId ?? null,
    access: page.access,
    ...overrides,
    children: overrides.children ?? [],
  };
}

export function mapDatabaseToTreeNode(
  database: TreeDatabaseSource,
  page: TreePageSource,
  overrides: Partial<SpaceTreeNode> = {},
): SpaceTreeNode {
  return {
    id: page.id,
    nodeType: "database",
    slugId: page.slugId ?? null,
    databaseId: database.id,
    name: database.name ?? page.title ?? "",
    icon: database.icon ?? page.icon ?? null,
    status:
      (database.status as PageCustomFieldStatus | null | undefined) ??
      page.customFields?.status ??
      null,
    position: page.position ?? "",
    hasChildren: Boolean(page.hasChildren),
    spaceId: database.spaceId ?? page.spaceId,
    parentPageId: page.parentPageId ?? null,
    access: page.access,
    ...overrides,
    children: overrides.children ?? [],
  };
}

export function buildTree(nodes: Array<ISidebarNode | IPage>): SpaceTreeNode[] {
  const pageMap: Record<string, SpaceTreeNode> = {};

  const tree: SpaceTreeNode[] = [];

  nodes.forEach((node) => {
    const isSidebarNode = "nodeType" in node;

    pageMap[node.id] = mapPageToTreeNode(node, {
      nodeType: isSidebarNode ? node.nodeType : "page",
      slugId: isSidebarNode ? (node.slugId ?? null) : node.slugId,
      databaseId: isSidebarNode ? (node.databaseId ?? null) : null,
      access: isSidebarNode ? (node.access ?? undefined) : undefined,
    });
  });

  nodes.forEach((node) => {
    tree.push(pageMap[node.id]);
  });

  return sortPositionKeys(tree);
}

export function resolveActiveTreeSlug({
  pageSlug,
  databaseSlug,
}: {
  pageSlug?: string;
  databaseSlug?: string;
}): string | undefined {
  return pageSlug ?? databaseSlug;
}

/**
 * Enriches the breadcrumb path with sidebar node discriminators while keeping
 * the breadcrumb parent chain intact.
 */
export function mergeTreeNodeMetadata(
  breadcrumbNodes: SpaceTreeNode[],
  sidebarNodes: SpaceTreeNode[],
): SpaceTreeNode[] {
  const nodesById = new Map(
    breadcrumbNodes.map((node) => [node.id, node] as const),
  );

  sidebarNodes.forEach((sidebarNode) => {
    const breadcrumbNode = nodesById.get(sidebarNode.id);

    nodesById.set(
      sidebarNode.id,
      breadcrumbNode
        ? {
            ...breadcrumbNode,
            ...sidebarNode,
            parentPageId: breadcrumbNode.parentPageId,
            children: breadcrumbNode.children,
          }
        : sidebarNode,
    );
  });

  return Array.from(nodesById.values());
}

export function findBreadcrumbPath(
  tree: SpaceTreeNode[],
  pageId: string,
  path: SpaceTreeNode[] = [],
): SpaceTreeNode[] | null {
  for (const node of tree) {
    if (!node.name || node.name.trim() === "") {
      node.name = "untitled";
    }

    if (node.id === pageId) {
      return [...path, node];
    }

    if (node.children) {
      const newPath = findBreadcrumbPath(node.children, pageId, [
        ...path,
        node,
      ]);
      if (newPath) {
        return newPath;
      }
    }
  }
  return null;
}

export const updateTreeNodeName = (
  nodes: SpaceTreeNode[],
  nodeId: string,
  newName: string,
): SpaceTreeNode[] => {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, name: newName };
    }
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: updateTreeNodeName(node.children, nodeId, newName),
      };
    }
    return node;
  });
};

export const updateTreeNodeIcon = (
  nodes: SpaceTreeNode[],
  nodeId: string,
  newIcon: string | null,
): SpaceTreeNode[] => {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, icon: newIcon };
    }
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: updateTreeNodeIcon(node.children, nodeId, newIcon),
      };
    }
    return node;
  });
};

export const updateDatabaseTreeNodeMeta = (
  nodes: SpaceTreeNode[],
  database: {
    id?: string | null;
    pageId?: string | null;
    pageSlugId?: string | null;
    name?: string;
    icon?: string | null;
    status?: PageCustomFieldStatus | null;
  },
): SpaceTreeNode[] => {
  let didUpdate = false;

  const nextNodes = nodes.map((node) => {
    const nextChildren =
      node.children.length > 0
        ? updateDatabaseTreeNodeMeta(node.children, database)
        : node.children;
    const didUpdateChildren = nextChildren !== node.children;
    const isTargetDatabase =
      node.nodeType === "database" &&
      ((database.pageId && node.id === database.pageId) ||
        (database.id && node.databaseId === database.id));

    if (!isTargetDatabase) {
      if (didUpdateChildren) {
        didUpdate = true;
        return { ...node, children: nextChildren };
      }

      return node;
    }

    didUpdate = true;

    return {
      ...node,
      ...(database.name !== undefined ? { name: database.name } : {}),
      ...(database.icon !== undefined ? { icon: database.icon } : {}),
      ...(typeof database.pageSlugId === "string"
        ? { slugId: database.pageSlugId }
        : {}),
      ...(database.status !== undefined ? { status: database.status } : {}),
      children: didUpdateChildren ? nextChildren : node.children,
    };
  });

  return didUpdate ? nextNodes : nodes;
};

/**
 * Removes a node and its subtree from local tree state by delegating to
 * `SimpleTree.drop`, so tree structure and parent metadata remain consistent.
 */
export const dropTreeNode = (
  nodes: SpaceTreeNode[],
  nodeId: string,
): SpaceTreeNode[] => {
  const treeApi = new SimpleTree<SpaceTreeNode>(nodes);

  if (!treeApi.find(nodeId)) {
    return nodes;
  }

  treeApi.drop({ id: nodeId });

  return treeApi.data;
};

/**
 * @deprecated Use `dropTreeNode` directly. This compatibility wrapper will be
 * removed after 2026-06-30.
 */
export const deleteTreeNode = (
  nodes: SpaceTreeNode[],
  nodeId: string,
): SpaceTreeNode[] => {
  return dropTreeNode(nodes, nodeId);
};

export function buildTreeWithChildren(items: SpaceTreeNode[]): SpaceTreeNode[] {
  const nodeMap = {};
  let result: SpaceTreeNode[] = [];

  // Create a reference object for each item with the specified structure
  items.forEach((item) => {
    nodeMap[item.id] = { ...item, children: [] };
  });

  // Build the tree array
  items.forEach((item) => {
    const node = nodeMap[item.id];
    if (item.parentPageId !== null) {
      // Find the parent node and add the current node to its children
      nodeMap[item.parentPageId].children.push(node);
    } else {
      // If the item has no parent, it's a root node, so add it to the result array
      result.push(node);
    }
  });

  result = sortPositionKeys(result);

  // Recursively sort the children of each node
  function sortChildren(node: SpaceTreeNode) {
    if (node.children.length > 0) {
      node.hasChildren = true;
      node.children = sortPositionKeys(node.children);
      node.children.forEach(sortChildren);
    }
  }

  result.forEach(sortChildren);

  return result;
}

export function appendNodeChildren(
  treeItems: SpaceTreeNode[],
  nodeId: string,
  children: SpaceTreeNode[],
) {
  // Preserve deeper children if they exist and remove node if deleted
  return treeItems.map((node) => {
    if (node.id === nodeId) {
      const newIds = new Set(children.map((c) => c.id));

      const existingMap = new Map(
        (node.children ?? [])
          .filter((c) => newIds.has(c.id))
          .map((c) => [c.id, c]),
      );

      const merged = children.map((newChild) => {
        const existing = existingMap.get(newChild.id);
        return existing && existing.children
          ? { ...newChild, children: existing.children }
          : newChild;
      });

      return {
        ...node,
        children: merged,
      };
    }

    if (node.children) {
      return {
        ...node,
        children: appendNodeChildren(node.children, nodeId, children),
      };
    }

    return node;
  });
}

/**
 * Updates hasChildren for the target node.
 *
 * This flag is required for instant sidebar indicator switching:
 * when the first database row is created, chevron should be shown
 * immediately instead of a dot, even before tree refetch.
 */
export function setTreeNodeHasChildren(
  treeItems: SpaceTreeNode[],
  nodeId: string,
  hasChildren: boolean,
): SpaceTreeNode[] {
  return treeItems.map((node) => {
    if (node.id === nodeId) {
      return { ...node, hasChildren };
    }

    if (node.children.length > 0) {
      return {
        ...node,
        children: setTreeNodeHasChildren(node.children, nodeId, hasChildren),
      };
    }

    return node;
  });
}

/**
 * Inserts a database row into local tree via SimpleTree and guarantees
 * parent database node is marked as having children.
 */
export function insertDatabaseRowNode(
  treeItems: SpaceTreeNode[],
  parentId: string,
  rowNode: SpaceTreeNode,
  index?: number,
): { tree: SpaceTreeNode[]; index: number } {
  const treeWithParentChildren = setTreeNodeHasChildren(
    treeItems,
    parentId,
    true,
  );
  const nextTree = new SimpleTree(treeWithParentChildren);
  const parentNode = nextTree.find(parentId);
  const insertionIndex =
    typeof index === "number" ? index : (parentNode?.children?.length ?? 0);

  nextTree.create({
    parentId,
    index: insertionIndex,
    data: rowNode,
  });

  return {
    tree: nextTree.data,
    index: insertionIndex,
  };
}

export function insertOrUpdateTreeNode(
  treeItems: SpaceTreeNode[],
  node: SpaceTreeNode,
  index?: number,
): { tree: SpaceTreeNode[]; index: number; inserted: boolean } {
  const parentId = node.parentPageId ?? null;
  const treeWithParentChildren = parentId
    ? setTreeNodeHasChildren(treeItems, parentId, true)
    : treeItems;
  const nextTree = new SimpleTree<SpaceTreeNode>(treeWithParentChildren);
  const existingNode = nextTree.find(node.id);

  if (existingNode) {
    const { children: _children, ...changes } = node;

    nextTree.update({
      id: node.id,
      changes,
    });

    return {
      tree: nextTree.data,
      index: existingNode.childIndex,
      inserted: false,
    };
  }

  const parentNode = parentId ? nextTree.find(parentId) : null;
  const insertionIndex =
    typeof index === "number"
      ? index
      : parentId
        ? (parentNode?.children?.length ?? 0)
        : nextTree.data.length;

  nextTree.create({
    parentId,
    index: insertionIndex,
    data: node,
  });

  return {
    tree: nextTree.data,
    index: insertionIndex,
    inserted: true,
  };
}

/**
 * Merge root nodes; keep existing ones intact, append new ones,
 */
export function mergeRootTrees(
  prevRoots: SpaceTreeNode[],
  incomingRoots: SpaceTreeNode[],
): SpaceTreeNode[] {
  const seen = new Set(prevRoots.map((r) => r.id));

  // add new roots that were not present before
  const merged = [...prevRoots];
  incomingRoots.forEach((node) => {
    if (!seen.has(node.id)) merged.push(node);
  });

  return sortPositionKeys(merged);
}
