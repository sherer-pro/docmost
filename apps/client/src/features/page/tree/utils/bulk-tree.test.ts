import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SpaceTreeNode } from "@/features/page/tree/types.ts";
import {
  areAllTreeNodesExpanded,
  getExpandableTreeNodeIds,
  loadTreeRecursively,
  updateTreeNodesOpenState,
} from "./bulk-tree.ts";

function createNode(
  id: string,
  {
    children = [],
    hasChildren = children.length > 0,
  }: {
    children?: SpaceTreeNode[];
    hasChildren?: boolean;
  } = {},
): SpaceTreeNode {
  return {
    id,
    nodeType: "page",
    slugId: id,
    databaseId: null,
    name: id,
    icon: null,
    status: null,
    position: id,
    spaceId: "space-1",
    parentPageId: null,
    hasChildren,
    children,
  };
}

describe("bulk tree open state", () => {
  it("tracks only nodes that can expand", () => {
    const loadedFolder = createNode("loaded", {
      children: [createNode("leaf")],
    });
    const unloadedFolder = createNode("unloaded", { hasChildren: true });

    const expandableNodeIds = getExpandableTreeNodeIds([
      loadedFolder,
      unloadedFolder,
      createNode("other-leaf"),
    ]);

    assert.deepEqual(expandableNodeIds, ["loaded", "unloaded"]);
    assert.equal(
      areAllTreeNodesExpanded(expandableNodeIds, {
        loaded: true,
        unloaded: false,
      }),
      false,
    );
    assert.equal(
      areAllTreeNodesExpanded(expandableNodeIds, {
        loaded: true,
        unloaded: true,
      }),
      true,
    );
    assert.equal(areAllTreeNodesExpanded([], {}), false);
  });

  it("updates only the requested node ids", () => {
    assert.deepEqual(
      updateTreeNodesOpenState(
        { untouched: true, folder: false },
        ["folder"],
        true,
      ),
      { untouched: true, folder: true },
    );
  });
});

describe("loadTreeRecursively", () => {
  it("loads every missing level and reports expandable nodes", async () => {
    const loadCalls: string[] = [];
    const appendedChildren: string[] = [];

    const result = await loadTreeRecursively(
      [createNode("root", { hasChildren: true })],
      async (node) => {
        loadCalls.push(node.id);

        if (node.id === "root") {
          return [createNode("child", { hasChildren: true })];
        }

        return [createNode("grandchild")];
      },
      {
        onChildrenLoaded: (parentId) => appendedChildren.push(parentId),
      },
    );

    assert.deepEqual(loadCalls, ["root", "child"]);
    assert.deepEqual(appendedChildren, ["root", "child"]);
    assert.deepEqual(result.expandableNodeIds, ["root", "child"]);
    assert.equal(result.tree[0].children[0].children[0].id, "grandchild");
    assert.deepEqual(result.failedNodeIds, []);
    assert.equal(result.cancelled, false);
  });

  it("does not reload children already present in memory", async () => {
    const root = createNode("root", {
      children: [createNode("child")],
    });
    let loadCount = 0;

    const result = await loadTreeRecursively([root], async () => {
      loadCount += 1;
      return [];
    });

    assert.equal(loadCount, 0);
    assert.deepEqual(result.expandableNodeIds, ["root"]);
  });

  it("limits concurrent child requests", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const roots = Array.from({ length: 8 }, (_, index) =>
      createNode(`root-${index}`, { hasChildren: true }),
    );

    await loadTreeRecursively(
      roots,
      async (node) => {
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        await Promise.resolve();
        activeRequests -= 1;
        return [createNode(`${node.id}-child`)];
      },
      { concurrency: 4 },
    );

    assert.equal(maximumActiveRequests, 4);
  });

  it("keeps successful branches when another branch fails", async () => {
    const result = await loadTreeRecursively(
      [
        createNode("failed", { hasChildren: true }),
        createNode("successful", { hasChildren: true }),
      ],
      async (node) => {
        if (node.id === "failed") {
          throw new Error("request failed");
        }

        return [createNode("child")];
      },
    );

    assert.deepEqual(result.failedNodeIds, ["failed"]);
    assert.deepEqual(result.expandableNodeIds, ["successful"]);
    assert.equal(result.tree[1].children[0].id, "child");
  });

  it("stops applying loaded children after cancellation", async () => {
    let cancelled = false;
    let appendedChildren = 0;

    const result = await loadTreeRecursively(
      [createNode("root", { hasChildren: true })],
      async () => {
        cancelled = true;
        return [createNode("child")];
      },
      {
        isCancelled: () => cancelled,
        onChildrenLoaded: () => {
          appendedChildren += 1;
        },
      },
    );

    assert.equal(result.cancelled, true);
    assert.equal(appendedChildren, 0);
    assert.deepEqual(result.expandableNodeIds, []);
  });
});
