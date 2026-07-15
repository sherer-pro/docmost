import { atomWithStorage } from "jotai/utils";
import type { OpenMap } from "react-arborist/dist/main/state/open-slice";

export const OPEN_TREE_NODES_STORAGE_KEY = "docmost:sidebar-tree-open-state:v1";

export type OpenTreeNodesBySpace = Record<string, OpenMap>;

export const openTreeNodesBySpaceAtom = atomWithStorage<OpenTreeNodesBySpace>(
  OPEN_TREE_NODES_STORAGE_KEY,
  {},
  undefined,
  { getOnInit: true },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOpenTreeNodesBySpace(
  value: unknown,
): OpenTreeNodesBySpace {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<OpenTreeNodesBySpace>(
    (spaces, [spaceId, openState]) => {
      if (!isRecord(openState)) {
        return spaces;
      }

      spaces[spaceId] = Object.entries(openState).reduce<OpenMap>(
        (nodes, [nodeId, isOpen]) => {
          if (typeof isOpen === "boolean") {
            nodes[nodeId] = isOpen;
          }

          return nodes;
        },
        {},
      );

      return spaces;
    },
    {},
  );
}

export function getOpenTreeNodesForSpace(
  value: unknown,
  spaceId: string,
): OpenMap {
  return normalizeOpenTreeNodesBySpace(value)[spaceId] ?? {};
}

export function isOpenStateEqual(previous: OpenMap, next: OpenMap): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);

  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  return previousKeys.every((key) => previous[key] === next[key]);
}

export function updateOpenTreeNodesForSpace(
  value: unknown,
  spaceId: string,
  nextOpenState: OpenMap,
): OpenTreeNodesBySpace {
  const normalizedValue = normalizeOpenTreeNodesBySpace(value);

  return {
    ...normalizedValue,
    [spaceId]: nextOpenState,
  };
}
