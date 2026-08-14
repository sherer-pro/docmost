import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildTree,
  buildTreeWithChildren,
  deleteTreeNode,
  dropTreeNode,
  insertDatabaseRowNode,
  insertOrUpdateTreeNode,
  findTreeNodesByIds,
  mapDatabaseToTreeNode,
  mapPageToTreeNode,
  mergeTreeNodeMetadata,
  orderBreadcrumbNodes,
  resolveActiveTreeSlug,
  treeNodeContainsRouteSlug,
  updateDatabaseTreeNodeMeta,
} from "./utils";
import { SpaceTreeNode } from "../types";

function createNode(
  id: string,
  children: SpaceTreeNode[] = [],
  parentPageId: string | null = null,
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
    hasChildren: children.length > 0,
    spaceId: "space-1",
    parentPageId,
    children,
  };
}

describe("dropTreeNode", () => {
  it("removes a node together with all descendants", () => {
    const grandChild = createNode("grandchild", [], "child");
    const child = createNode("child", [grandChild], "parent");
    const parent = createNode("parent", [child]);
    const sibling = createNode("sibling");

    const nextTree = dropTreeNode([parent, sibling], "child");

    assert.equal(nextTree.length, 2);
    assert.equal(nextTree[0].id, "parent");
    assert.equal(nextTree[0].children.length, 0);
    assert.equal(nextTree[1].id, "sibling");
    assert.equal(JSON.stringify(nextTree).includes("grandchild"), false);
  });

  it("synchronizes nested structure when removing one root branch", () => {
    const leftChild = createNode("left-child", [], "left-root");
    const leftRoot = createNode("left-root", [leftChild]);
    const rightChild = createNode("right-child", [], "right-root");
    const rightRoot = createNode("right-root", [rightChild]);

    const nextTree = dropTreeNode([leftRoot, rightRoot], "left-root");

    assert.deepEqual(
      nextTree.map((node) => node.id),
      ["right-root"],
    );
    assert.deepEqual(
      nextTree[0].children.map((node) => node.id),
      ["right-child"],
    );
  });

  it("keeps backward-compatible deleteTreeNode wrapper aligned with dropTreeNode", () => {
    const child = createNode("child", [], "parent");
    const parent = createNode("parent", [child]);

    const dropResult = dropTreeNode([parent], "child");
    const deleteResult = deleteTreeNode([parent], "child");

    assert.deepEqual(deleteResult, dropResult);
  });
});

describe("tree node mappers", () => {
  it("maps a page into a complete tree node", () => {
    const node = mapPageToTreeNode({
      id: "page-id",
      slugId: "page-slug",
      title: "Page title",
      icon: "P",
      position: "a0",
      hasChildren: false,
      spaceId: "space-1",
      parentPageId: null,
      customFields: { status: "todo" as any },
    });

    assert.deepEqual(node, {
      id: "page-id",
      nodeType: "page",
      slugId: "page-slug",
      databaseId: null,
      name: "Page title",
      icon: "P",
      status: "todo",
      position: "a0",
      hasChildren: false,
      spaceId: "space-1",
      parentPageId: null,
      access: undefined,
      children: [],
      childrenLoaded: false,
    });
  });

  it("maps a database and its anchor page into a database tree node", () => {
    const node = mapDatabaseToTreeNode(
      {
        id: "database-id",
        spaceId: "space-1",
        name: "Database title",
        icon: "D",
        pageId: "database-page-id",
      },
      {
        id: "database-page-id",
        slugId: "database-slug",
        title: "Anchor title",
        icon: null,
        position: "a1",
        hasChildren: false,
        spaceId: "space-1",
        parentPageId: "parent-id",
      },
    );

    assert.equal(node.id, "database-page-id");
    assert.equal(node.nodeType, "database");
    assert.equal(node.databaseId, "database-id");
    assert.equal(node.slugId, "database-slug");
    assert.equal(node.name, "Database title");
    assert.equal(node.icon, "D");
    assert.equal(node.parentPageId, "parent-id");
  });

  it("preserves linked-template instance metadata from the sidebar contract", () => {
    const [node] = buildTree([
      {
        id: "linked-page-id",
        nodeType: "page",
        slugId: "linked-page",
        databaseId: null,
        title: "Linked page",
        icon: null,
        position: "a0",
        hasChildren: false,
        spaceId: "space-1",
        parentPageId: null,
        isLinkedTemplateInstance: true,
      },
    ]);

    assert.equal(node.isLinkedTemplateInstance, true);
  });
});

describe("active tree route", () => {
  it("resolves page and database route slugs through one contract", () => {
    assert.equal(resolveActiveTreeSlug({ pageSlug: "page-slug" }), "page-slug");
    assert.equal(
      resolveActiveTreeSlug({ databaseSlug: "database-slug" }),
      "database-slug",
    );
    assert.equal(resolveActiveTreeSlug({}), undefined);
  });

  it("finds a selected descendant from a canonical route with hyphenated title", () => {
    const child = {
      ...createNode("child", [], "parent"),
      slugId: "childslug1",
    };
    const parent = createNode("parent", [child]);

    assert.equal(
      treeNodeContainsRouteSlug(parent, "selected-child-title-childslug1"),
      true,
    );
    assert.equal(
      treeNodeContainsRouteSlug(parent, "unrelated-page-other-slug"),
      false,
    );
  });
});

describe("mergeTreeNodeMetadata", () => {
  it("keeps breadcrumb topology and applies database node discriminators", () => {
    const root = createNode("root");
    const databaseBreadcrumb = createNode("database-page", [], "root");
    const rowBreadcrumb = createNode("row-page", [], "database-page");

    const databaseNode: SpaceTreeNode = {
      ...databaseBreadcrumb,
      nodeType: "database",
      slugId: "database-slug",
      databaseId: "database-id",
      name: "Database",
      icon: "D",
    };
    const rowNode: SpaceTreeNode = {
      ...rowBreadcrumb,
      nodeType: "databaseRow",
      slugId: "row-slug",
      databaseId: "database-id",
      name: "Row",
    };

    const mergedNodes = mergeTreeNodeMetadata(
      [root, databaseBreadcrumb, rowBreadcrumb],
      [databaseNode, rowNode],
    );
    const restoredTree = buildTreeWithChildren(mergedNodes);
    const restoredDatabase = restoredTree[0].children[0];
    const restoredRow = restoredDatabase.children[0];

    assert.equal(restoredDatabase.nodeType, "database");
    assert.equal(restoredDatabase.databaseId, "database-id");
    assert.equal(restoredDatabase.slugId, "database-slug");
    assert.equal(restoredDatabase.parentPageId, "root");
    assert.equal(restoredRow.nodeType, "databaseRow");
    assert.equal(restoredRow.databaseId, "database-id");
    assert.equal(restoredRow.parentPageId, "database-page");
  });

  it("selects only breadcrumb metadata from a larger sidebar tree", () => {
    const database = {
      ...createNode("database-page"),
      nodeType: "database" as const,
      databaseId: "database-id",
    };
    const unrelated = createNode("unrelated");

    const matches = findTreeNodesByIds(
      [createNode("root", [database, unrelated])],
      new Set(["root", "database-page"]),
    );

    assert.deepEqual(
      matches.map((node) => node.id),
      ["root", "database-page"],
    );
  });

  it("orders an unordered breadcrumb chain from root to current page", () => {
    const database = createNode("database");
    const row = createNode("row", [], "database");
    const child = createNode("child", [], "row");

    assert.deepEqual(
      orderBreadcrumbNodes([database, child, row]).map((node) => node.id),
      ["database", "row", "child"],
    );
  });
});

describe("insertDatabaseRowNode", () => {
  it("marks database parent as expandable and inserts first row immediately", () => {
    const databaseNode: SpaceTreeNode = {
      id: "database-page-id",
      nodeType: "database",
      slugId: "database-slug",
      databaseId: "database-id",
      name: "Database",
      icon: null,
      status: null,
      position: "a0",
      hasChildren: false,
      spaceId: "space-1",
      parentPageId: null,
      children: [],
    };

    const rowNode: SpaceTreeNode = {
      id: "row-page-id",
      nodeType: "databaseRow",
      slugId: "row-slug",
      databaseId: "database-id",
      name: "",
      icon: null,
      status: null,
      position: "a1",
      hasChildren: false,
      spaceId: "space-1",
      parentPageId: "database-page-id",
      children: [],
    };

    const { tree: nextTree } = insertDatabaseRowNode(
      [databaseNode],
      "database-page-id",
      rowNode,
    );

    assert.equal(nextTree[0].hasChildren, true);
    assert.equal(nextTree[0].children.length, 1);
    assert.equal(nextTree[0].children[0].id, "row-page-id");
  });
});

describe("insertOrUpdateTreeNode", () => {
  it("marks parent as expandable and inserts a child database immediately", () => {
    const parent = createNode("parent");
    const databaseNode: SpaceTreeNode = {
      id: "database-page-id",
      nodeType: "database",
      slugId: "database-slug",
      databaseId: "database-id",
      name: "Database",
      icon: null,
      status: null,
      position: "a1",
      hasChildren: false,
      spaceId: "space-1",
      parentPageId: "parent",
      children: [],
    };

    const {
      tree: nextTree,
      index,
      inserted,
    } = insertOrUpdateTreeNode([parent], databaseNode);

    assert.equal(inserted, true);
    assert.equal(index, 0);
    assert.equal(nextTree[0].hasChildren, true);
    assert.equal(nextTree[0].children.length, 1);
    assert.equal(nextTree[0].children[0].nodeType, "database");
    assert.equal(nextTree[0].children[0].databaseId, "database-id");
  });
});

describe("updateDatabaseTreeNodeMeta", () => {
  it("updates a nested database node by linked page id", () => {
    const rowNode = createNode("row-page-id", [], "database-page-id");
    rowNode.nodeType = "databaseRow";
    rowNode.databaseId = "database-id";

    const databaseNode: SpaceTreeNode = {
      id: "database-page-id",
      nodeType: "database",
      slugId: "old-database-slug",
      databaseId: "database-id",
      name: "Old database",
      icon: null,
      status: null,
      position: "a1",
      hasChildren: true,
      spaceId: "space-1",
      parentPageId: "parent",
      children: [rowNode],
    };
    const parent = createNode("parent", [databaseNode]);

    const nextTree = updateDatabaseTreeNodeMeta([parent], {
      id: "database-id",
      pageId: "database-page-id",
      pageSlugId: "new-database-slug",
      name: "New database",
      icon: "D",
    });

    const nextDatabaseNode = nextTree[0].children[0];
    assert.equal(nextDatabaseNode.name, "New database");
    assert.equal(nextDatabaseNode.icon, "D");
    assert.equal(nextDatabaseNode.slugId, "new-database-slug");
    assert.deepEqual(
      nextDatabaseNode.children.map((node) => node.id),
      ["row-page-id"],
    );
  });

  it("keeps the current slug when the database update response has no page slug", () => {
    const databaseNode: SpaceTreeNode = {
      id: "database-page-id",
      nodeType: "database",
      slugId: "current-slug",
      databaseId: "database-id",
      name: "Old database",
      icon: null,
      status: null,
      position: "a1",
      hasChildren: false,
      spaceId: "space-1",
      parentPageId: null,
      children: [],
    };

    const nextTree = updateDatabaseTreeNodeMeta([databaseNode], {
      id: "database-id",
      pageId: "database-page-id",
      pageSlugId: null,
      name: "New database",
    });

    assert.equal(nextTree[0].name, "New database");
    assert.equal(nextTree[0].slugId, "current-slug");
  });
});
