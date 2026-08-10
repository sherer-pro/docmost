import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ISpace } from "@/features/space/types/space.types";
import { applySpaceUpdateToCache } from "./space-query-cache";
import { invalidateAccessSensitiveSearchCaches } from "./access-sensitive-search-cache";

function space(identifier: string): ISpace {
  return {
    id: identifier,
    slug: "general",
    settings: { dictionary: { enabled: false } },
  } as ISpace;
}

describe("applySpaceUpdateToCache", () => {
  it("updates id and slug cache entries when the event omits the slug", () => {
    const queryClient = new QueryClient();
    const cachedSpace = space("space-1");
    queryClient.setQueryData(["space", "space-1"], cachedSpace);
    queryClient.setQueryData(["space", "general"], cachedSpace);

    applySpaceUpdateToCache(queryClient, "space-1", {
      settings: { dictionary: { enabled: true } },
    });

    expect(
      queryClient.getQueryData<ISpace>(["space", "space-1"])?.settings
        ?.dictionary?.enabled,
    ).toBe(true);
    expect(
      queryClient.getQueryData<ISpace>(["space", "general"])?.settings
        ?.dictionary?.enabled,
    ).toBe(true);
  });
});

describe("invalidateAccessSensitiveSearchCaches", () => {
  it("drops inactive results and refetches active results for every search surface", async () => {
    const queryClient = new QueryClient();
    const queryRoots = [
      "unified-search",
      "page-search",
      "attachment-search",
      "search-suggestion",
    ];

    for (const queryRoot of queryRoots) {
      queryClient.setQueryData([queryRoot, { query: "private" }], {
        secret: true,
      });
    }

    invalidateAccessSensitiveSearchCaches(queryClient);

    await Promise.resolve();
    for (const queryRoot of queryRoots) {
      expect(queryClient.getQueriesData({ queryKey: [queryRoot] })).toEqual([]);
    }
  });
});
