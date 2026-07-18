import type { OpenMap } from "react-arborist/dist/main/state/open-slice";
import type { SpaceTreeNode } from "@/features/page/tree/types.ts";

export const BULK_TREE_LOAD_CONCURRENCY = 4;

export type LoadTreeNodeChildren = (
  node: SpaceTreeNode,
) => Promise<SpaceTreeNode[]>;

interface LoadTreeRecursivelyOptions {
  concurrency?: number;
  isCancelled?: () => boolean;
  onChildrenLoaded?: (parentId: string, children: SpaceTreeNode[]) => void;
}

export interface LoadTreeRecursivelyResult {
  tree: SpaceTreeNode[];
  expandableNodeIds: string[];
  failedNodeIds: string[];
  cancelled: boolean;
}

function createConcurrencyLimiter(concurrency: number) {
  const queue: Array<() => void> = [];
  let activeTasks = 0;

  const runNext = () => {
    if (activeTasks >= concurrency) {
      return;
    }

    const nextTask = queue.shift();
    if (!nextTask) {
      return;
    }

    activeTasks += 1;
    nextTask();
  };

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      runNext();
    });

    try {
      return await task();
    } finally {
      activeTasks -= 1;
      runNext();
    }
  };
}

export function getExpandableTreeNodeIds(tree: SpaceTreeNode[]): string[] {
  const nodeIds: string[] = [];

  const visit = (nodes: SpaceTreeNode[]) => {
    for (const node of nodes) {
      if (node.hasChildren || node.children.length > 0) {
        nodeIds.push(node.id);
      }

      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(tree);
  return nodeIds;
}

export function areAllTreeNodesExpanded(
  expandableNodeIds: string[],
  openState: OpenMap,
): boolean {
  return (
    expandableNodeIds.length > 0 &&
    expandableNodeIds.every((nodeId) => openState[nodeId] === true)
  );
}

export function updateTreeNodesOpenState(
  openState: OpenMap,
  nodeIds: string[],
  isOpen: boolean,
): OpenMap {
  const nextOpenState = { ...openState };

  for (const nodeId of nodeIds) {
    nextOpenState[nodeId] = isOpen;
  }

  return nextOpenState;
}

export async function loadTreeRecursively(
  tree: SpaceTreeNode[],
  loadChildren: LoadTreeNodeChildren,
  options: LoadTreeRecursivelyOptions = {},
): Promise<LoadTreeRecursivelyResult> {
  const concurrency = Math.max(
    1,
    options.concurrency ?? BULK_TREE_LOAD_CONCURRENCY,
  );
  const isCancelled = options.isCancelled ?? (() => false);
  const runLimited = createConcurrencyLimiter(concurrency);
  const expandableNodeIds = new Set<string>();
  const failedNodeIds = new Set<string>();

  const visitNode = async (node: SpaceTreeNode): Promise<SpaceTreeNode> => {
    if (isCancelled()) {
      return node;
    }

    let children = node.children;

    if (node.hasChildren && children.length === 0) {
      try {
        children = await runLimited(async () => {
          if (isCancelled()) {
            return [];
          }

          return loadChildren(node);
        });
      } catch {
        failedNodeIds.add(node.id);
        return node;
      }

      if (isCancelled()) {
        return node;
      }

      options.onChildrenLoaded?.(node.id, children);
    }

    if (children.length === 0) {
      return { ...node, children };
    }

    expandableNodeIds.add(node.id);
    const hydratedChildren = await Promise.all(children.map(visitNode));

    return {
      ...node,
      children: hydratedChildren,
    };
  };

  const hydratedTree = await Promise.all(tree.map(visitNode));

  return {
    tree: hydratedTree,
    expandableNodeIds: [...expandableNodeIds],
    failedNodeIds: [...failedNodeIds],
    cancelled: isCancelled(),
  };
}
