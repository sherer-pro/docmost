import assert from "node:assert/strict";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, it, vi } from "vitest";
import { invalidateOnCreatePage, invalidateOnDeletePage } from "./page-query";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom";
import type { SpaceTreeNode } from "@/features/page/tree/types";

type QueryEntry = {
  key: readonly unknown[];
  data: any;
};

const mocks = vi.hoisted(() => {
  const entries: QueryEntry[] = [];
  const invalidateCalls: any[] = [];
  const removeCalls: any[] = [];

  const keyMatchesPrefix = (
    queryKey: readonly unknown[],
    prefix: readonly unknown[],
  ) => prefix.every((part, index) => Object.is(part, queryKey[index]));

  const keyMatchesExact = (
    left: readonly unknown[],
    right: readonly unknown[],
  ) =>
    left.length === right.length &&
    left.every((part, index) => Object.is(part, right[index]));

  return {
    entries,
    invalidateCalls,
    removeCalls,
    queryClient: {
      getQueriesData: (filters: any = {}) =>
        entries
          .filter((entry) => {
            if (filters.predicate) {
              return filters.predicate({ queryKey: entry.key });
            }

            if (filters.queryKey) {
              return filters.exact
                ? keyMatchesExact(entry.key, filters.queryKey)
                : keyMatchesPrefix(entry.key, filters.queryKey);
            }

            return true;
          })
          .map((entry) => [entry.key, entry.data]),
      getQueryData: (queryKey: readonly unknown[]) =>
        entries.find((entry) => keyMatchesExact(entry.key, queryKey))?.data,
      setQueryData: (queryKey: readonly unknown[], updater: any) => {
        const entry = entries.find((item) =>
          keyMatchesExact(item.key, queryKey),
        );
        const previous = entry?.data;
        const next =
          typeof updater === "function" ? updater(previous) : updater;

        if (entry) {
          entry.data = next;
          return;
        }

        entries.push({ key: queryKey, data: next });
      },
      invalidateQueries: (payload: any) => {
        invalidateCalls.push(payload);
        return Promise.resolve();
      },
      removeQueries: (filters: any = {}) => {
        removeCalls.push(filters);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const entry = entries[index];
          if (
            filters.predicate?.({
              queryKey: entry.key,
              state: { data: entry.data },
            })
          ) {
            entries.splice(index, 1);
          }
        }
      },
    },
  };
});

vi.mock("@/main.tsx", () => ({
  queryClient: mocks.queryClient,
}));

const jotaiStore = getDefaultStore();

function createTreeNode(id: string): SpaceTreeNode {
  return {
    id,
    nodeType: "page",
    slugId: id,
    databaseId: null,
    name: id,
    icon: null,
    status: null,
    position: id,
    hasChildren: false,
    spaceId: "space-1",
    parentPageId: null,
    children: [],
  };
}

describe("invalidateOnCreatePage", () => {
  beforeEach(() => {
    mocks.entries.length = 0;
    mocks.invalidateCalls.length = 0;
    mocks.removeCalls.length = 0;
    jotaiStore.set(treeDataAtom, []);
  });

  it("updates the active root sidebar key that includes page and database node types", () => {
    const rootKey = ["root-sidebar-pages", "space-1", ["page", "database"]];
    mocks.entries.push({
      key: rootKey,
      data: {
        pageParams: [undefined],
        pages: [
          {
            items: [],
            meta: {},
          },
        ],
      },
    });

    invalidateOnCreatePage({
      id: "page-1",
      title: "Fresh page",
      slugId: "fresh-page",
      icon: null,
      position: "a0",
      hasChildren: false,
      parentPageId: null,
      spaceId: "space-1",
    });

    assert.equal(mocks.entries.length, 1);
    assert.deepEqual(mocks.entries[0].key, rootKey);
    assert.deepEqual(mocks.entries[0].data.pages[0].items, [
      {
        creatorId: undefined,
        customFields: undefined,
        databaseId: null,
        hasChildren: false,
        icon: null,
        id: "page-1",
        nodeType: "page",
        parentPageId: null,
        position: "a0",
        slugId: "fresh-page",
        spaceId: "space-1",
        title: "Fresh page",
      },
    ]);
  });

  it("syncs the local tree by default for external create events", () => {
    const parent = createTreeNode("parent");
    jotaiStore.set(treeDataAtom, [parent]);

    invalidateOnCreatePage({
      id: "child",
      title: "Child",
      slugId: "child",
      icon: null,
      position: "a0",
      hasChildren: false,
      parentPageId: "parent",
      spaceId: "space-1",
    });

    const treeData = jotaiStore.get(treeDataAtom);
    assert.equal(treeData[0].hasChildren, true);
    assert.equal(treeData[0].children.length, 1);
    assert.equal(treeData[0].children[0].id, "child");
  });

  it("can skip local tree sync when the caller inserts the node itself", () => {
    const parent = createTreeNode("parent");
    const sidebarKey = [
      "sidebar-pages",
      { spaceId: "space-1", pageId: "parent" },
    ];
    jotaiStore.set(treeDataAtom, [parent]);
    mocks.entries.push({
      key: sidebarKey,
      data: {
        pageParams: [undefined],
        pages: [
          {
            items: [],
            meta: {},
          },
        ],
      },
    });

    invalidateOnCreatePage(
      {
        id: "child",
        title: "Child",
        slugId: "child",
        icon: null,
        position: "a0",
        hasChildren: false,
        parentPageId: "parent",
        spaceId: "space-1",
      },
      { syncTree: false },
    );

    const treeData = jotaiStore.get(treeDataAtom);
    assert.equal(treeData[0].hasChildren, false);
    assert.equal(treeData[0].children.length, 0);
    assert.equal(mocks.entries[0].data.pages[0].items.length, 1);
    assert.equal(mocks.entries[0].data.pages[0].items[0].id, "child");
  });
});

describe("invalidateOnDeletePage", () => {
  beforeEach(() => {
    mocks.entries.length = 0;
    mocks.invalidateCalls.length = 0;
    mocks.removeCalls.length = 0;
    jotaiStore.set(treeDataAtom, []);
  });

  it("returns the removed subtree so route reconciliation can inspect it", () => {
    const child = {
      ...createTreeNode("child"),
      parentPageId: "parent",
      slugId: "childslug1",
    };
    const parent = {
      ...createTreeNode("parent"),
      hasChildren: true,
      children: [child],
    };
    jotaiStore.set(treeDataAtom, [parent]);

    const deletedNode = invalidateOnDeletePage("parent");

    assert.equal(deletedNode?.children[0].slugId, "childslug1");
    assert.deepEqual(jotaiStore.get(treeDataAtom), []);
  });

  it("removes id and slug caches for every loaded page in the deleted subtree", () => {
    const child = {
      ...createTreeNode("child"),
      parentPageId: "parent",
      slugId: "childslug1",
    };
    const parent = {
      ...createTreeNode("parent"),
      slugId: "parentslug1",
      hasChildren: true,
      children: [child],
    };
    jotaiStore.set(treeDataAtom, [parent]);
    mocks.entries.push(
      { key: ["pages", "parent"], data: { id: "parent" } },
      { key: ["pages", "parentslug1"], data: { id: "parent" } },
      { key: ["pages", "childslug1"], data: { id: "child" } },
      { key: ["pages", "unrelated"], data: { id: "unrelated" } },
    );

    invalidateOnDeletePage("parent");

    assert.deepEqual(
      mocks.entries
        .filter((entry) => entry.key[0] === "pages")
        .map((entry) => entry.key[1]),
      ["unrelated"],
    );
    assert.equal(mocks.removeCalls.length, 1);
  });
});
