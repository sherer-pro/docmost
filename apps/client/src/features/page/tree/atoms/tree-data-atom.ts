import { atom } from "jotai";
import { SpaceTreeNode } from "@/features/page/tree/types";
import { appendNodeChildren, dropTreeNode } from "../utils";

export const treeDataAtom = atom<SpaceTreeNode[]>([]);

// Atom
export const appendNodeChildrenAtom = atom(
  null,
  (
    get,
    set,
    { parentId, children }: { parentId: string; children: SpaceTreeNode[] }
  ) => {
    const currentTree = get(treeDataAtom);
    const updatedTree = appendNodeChildren(currentTree, parentId, children);
    set(treeDataAtom, updatedTree);
  }
);

/**
 * A single atom operation to remove a node from a tree.
 *
 * Important: cascade deletion - together with child nodes (for example, databaseRow),
 * so that the local tree after deleting the database-page does not contain “dangling” nodes.
 */
export const dropTreeNodeAtom = atom(null, (get, set, nodeId: string) => {
  const currentTree = get(treeDataAtom);
  const updatedTree = dropTreeNode(currentTree, nodeId);
  set(treeDataAtom, updatedTree);
});
