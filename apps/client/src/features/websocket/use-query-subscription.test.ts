import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ISpace } from "@/features/space/types/space.types";
import { applySpaceUpdateToCache } from "./space-query-cache";

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
