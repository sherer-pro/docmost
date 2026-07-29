export const TREE_EXTERNAL_DROP_KIND = "docmost-tree-external-drop";

export interface TreeExternalDropResult {
  kind: typeof TREE_EXTERNAL_DROP_KIND;
  target: string;
}

export function createTreeExternalDropResult(
  target: string,
): TreeExternalDropResult {
  return {
    kind: TREE_EXTERNAL_DROP_KIND,
    target,
  };
}

export function isTreeExternalDropResult(
  value: unknown,
): value is TreeExternalDropResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === TREE_EXTERNAL_DROP_KIND
  );
}
