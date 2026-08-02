import {
  AiConversationContext,
  AiContextSource,
  AiContextSourceType,
  AiDescendantSelection,
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
    hasChildren: Boolean(node.hasChildren || node.children?.length),
    descendants: { mode: "none", pageIds: [] },
  };
}

export function getAiIncludedPageIds(
  context: Pick<
    AiConversationContext,
    "includeCurrentDocument" | "currentDocumentDescendants" | "sources"
  >,
  currentPageId: string,
): Set<string> {
  const ids = new Set(context.sources.map((source) => source.pageId));
  if (context.includeCurrentDocument) ids.add(currentPageId);
  context.currentDocumentDescendants.pageIds.forEach((pageId) =>
    ids.add(pageId),
  );
  context.sources.forEach((source) =>
    source.descendants.pageIds.forEach((pageId) => ids.add(pageId)),
  );
  return ids;
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

export function dedupeAiContextSources(
  sources: AiContextSource[],
): AiContextSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const identity = source.pageId;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

interface AiContextTriggerCountInput {
  currentDocumentAvailable: boolean;
  includeCurrentDocument: boolean;
  sourceCount: number;
  fileCount: number;
  attachmentCount: number;
}

export function getAiContextTriggerCount(
  input: AiContextTriggerCountInput,
): number {
  return (
    (input.currentDocumentAvailable && input.includeCurrentDocument ? 1 : 0) +
    input.sourceCount +
    input.fileCount +
    input.attachmentCount
  );
}

export function getAiContextScopeSummary(selection: AiDescendantSelection): {
  mode: AiDescendantSelection["mode"];
  selectedCount: number;
} {
  return {
    mode: selection.mode,
    selectedCount: selection.mode === "selected" ? selection.pageIds.length : 0,
  };
}
