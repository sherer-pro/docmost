import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SpaceTreeNode } from "../types";
import {
  applyAddTreeNode,
  applyDeleteTreeNode,
  applyMoveTreeNode,
  applyUpdateOneTreeNode,
} from "./tree-event-reducer";

function createNode(
  id: string,
  children: SpaceTreeNode[] = [],
  parentPageId: string | null = null,
  position = id,
): SpaceTreeNode {
  return {
    id,
    nodeType: "page",
    slugId: id,
    databaseId: null,
    name: id,
    icon: null,
    status: null,
    position,
    hasChildren: children.length > 0,
    spaceId: "space-1",
    parentPageId,
    children,
  };
}

describe("tree event reducer", () => {
  it("adds a child node and keeps duplicate add events idempotent", () => {
    const parent = createNode("parent");
    const childInput = {
      id: "child",
      title: "Child",
      position: "b",
      spaceId: "space-1",
      parentPageId: "parent",
      hasChildren: false,
    };

    const withChild = applyAddTreeNode([parent], childInput);
    const afterDuplicate = applyAddTreeNode(withChild, {
      ...childInput,
      title: "Renamed child",
    });

    assert.equal(afterDuplicate[0].hasChildren, true);
    assert.equal(afterDuplicate[0].children.length, 1);
    assert.equal(afterDuplicate[0].children[0].name, "Renamed child");
  });

  it("updates title, icon, and status from an updateOne payload", () => {
    const nextTree = applyUpdateOneTreeNode([createNode("page")], "page", {
      title: "New title",
      icon: "N",
      customFields: { status: "todo" as any },
    });

    assert.equal(nextTree[0].name, "New title");
    assert.equal(nextTree[0].icon, "N");
    assert.equal(nextTree[0].status, "todo");
  });

  it("moves a node with its subtree and clears the old parent when empty", () => {
    const grandchild = createNode("grandchild", [], "child");
    const child = createNode("child", [grandchild], "old-parent", "m");
    const oldParent = createNode("old-parent", [child]);
    const newParent = createNode("new-parent");

    const nextTree = applyMoveTreeNode([oldParent, newParent], {
      id: "child",
      oldParentId: "old-parent",
      parentId: "new-parent",
      node: {
        id: "child",
        title: "Child",
        position: "a",
        spaceId: "space-1",
        parentPageId: "new-parent",
      },
    });

    assert.equal(nextTree[0].id, "old-parent");
    assert.equal(nextTree[0].hasChildren, false);
    assert.equal(nextTree[1].children[0].id, "child");
    assert.deepEqual(
      nextTree[1].children[0].children.map((node) => node.id),
      ["grandchild"],
    );
  });

  it("deletes a subtree and clears the parent when no children remain", () => {
    const child = createNode("child", [], "parent");
    const parent = createNode("parent", [child]);

    const nextTree = applyDeleteTreeNode([parent], "child");

    assert.equal(nextTree[0].children.length, 0);
    assert.equal(nextTree[0].hasChildren, false);
  });
});
