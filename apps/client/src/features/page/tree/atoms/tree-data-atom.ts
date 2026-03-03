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
 * Единая atom-операция удаления узла из дерева.
 *
 * Важно: удаление каскадное — вместе с дочерними узлами (например, databaseRow),
 * чтобы локальное дерево после удаления database-page не содержало «висячие» ноды.
 */
export const dropTreeNodeAtom = atom(null, (get, set, nodeId: string) => {
  const currentTree = get(treeDataAtom);
  const updatedTree = dropTreeNode(currentTree, nodeId);
  set(treeDataAtom, updatedTree);
});
