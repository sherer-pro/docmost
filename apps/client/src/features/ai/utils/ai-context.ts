import {
  AiContextSource,
  AiContextSourceType,
} from "@/features/ai/types/ai.types.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";

export function treeNodeToContextSource(
  node: SpaceTreeNode,
): AiContextSource | undefined {
  const sourceType: AiContextSourceType =
    node.nodeType === "database"
      ? "database"
      : node.nodeType === "databaseRow"
        ? "database_row"
        : "page";
  const sourceId = sourceType === "database" ? node.databaseId : node.id;
  if (!sourceId) return undefined;
  return {
    id: `${sourceType}:${sourceId}`,
    sourceType,
    sourceId,
    pageId: node.id,
    title: node.name,
    icon: node.icon ?? null,
    breadcrumbs: [],
    url: null,
    position: 0,
    available: true,
  };
}

export function findTreeNodeById(
  nodes: SpaceTreeNode[],
  id: string,
): SpaceTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findTreeNodeById(node.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}
