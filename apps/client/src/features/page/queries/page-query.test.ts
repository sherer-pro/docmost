import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import { invalidateOnCreatePage } from "./page-query";

type QueryEntry = {
  key: readonly unknown[];
  data: any;
};

const mocks = vi.hoisted(() => {
  const entries: QueryEntry[] = [];
  const invalidateCalls: any[] = [];

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
    },
  };
});

vi.mock("@/main.tsx", () => ({
  queryClient: mocks.queryClient,
}));

describe("invalidateOnCreatePage", () => {
  beforeEach(() => {
    mocks.entries.length = 0;
    mocks.invalidateCalls.length = 0;
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
});
