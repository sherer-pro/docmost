import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SpaceTreeNode } from "../types";
import { mergeRootTrees } from "./utils";

function node(
  id: string,
  position: string,
  children: SpaceTreeNode[] = [],
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
    spaceId: "space-1",
    parentPageId: null,
    hasChildren: children.length > 0,
    childrenLoaded: children.length > 0,
    children,
  };
}

describe("root tree reconciliation", () => {
  it("removes ghost roots and preserves loaded grandchildren", () => {
    const grandchild = { ...node("grandchild", "a"), parentPageId: "root" };
    const previous = [node("ghost", "a"), node("root", "b", [grandchild])];
    const incoming = [{ ...node("root", "c"), name: "Renamed" }];

    const reconciled = mergeRootTrees(previous, incoming);

    assert.deepEqual(
      reconciled.map((item) => item.id),
      ["root"],
    );
    assert.equal(reconciled[0].name, "Renamed");
    assert.equal(reconciled[0].position, "c");
    assert.equal(reconciled[0].children[0].id, "grandchild");
    assert.equal(reconciled[0].childrenLoaded, true);
  });
});
