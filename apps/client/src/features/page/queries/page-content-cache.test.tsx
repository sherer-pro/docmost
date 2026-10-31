// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { queryClient } from "@/lib/query-client";
import { updatePageContentCache, usePageQuery } from "./page-query";
import { PAGE_QUERY_KEYS } from "./query-keys";

it("updates both content aliases with a shared timestamp and settles multiple mounted readers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const id = "01a19056-bc9e-7ff4-b355-2bf05bd3db1d";
  const slugId = "content-alias";
  const initial = { id, slugId, title: "Preserved title", updatedAt: new Date(1000), content: "Initial" };
  queryClient.clear();
  queryClient.setQueryData(PAGE_QUERY_KEYS.page(id), initial);
  queryClient.setQueryData(PAGE_QUERY_KEYS.page(slugId), initial);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let renders = 0;
  function Observer({ pageId }: { pageId: string }) {
    if (++renders > 40) throw Error("Page content cache feedback loop");
    const { data } = usePageQuery({ pageId });
    return <output>{data?.content}</output>;
  }
  const flush = async () => {
    for (let turn = 0; turn < 8; turn++)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  };
  try {
    act(() => root.render(<QueryClientProvider client={queryClient}>
      <Observer pageId={id} /><Observer pageId={slugId} /><Observer pageId={slugId} />
    </QueryClientProvider>));
    await flush();
    act(() => updatePageContentCache(id, slugId, "Updated content"));
    const byId = queryClient.getQueryData<any>(PAGE_QUERY_KEYS.page(id));
    const bySlug = queryClient.getQueryData<any>(PAGE_QUERY_KEYS.page(slugId));
    expect(byId.updatedAt).toBe(bySlug.updatedAt);
    await flush();
    expect(Array.from(container.querySelectorAll("output"), (node) => node.textContent)).toEqual(["Updated content", "Updated content", "Updated content"]);
    expect(renders).toBeLessThan(20);
    expect(byId.title).toBe("Preserved title");
    updatePageContentCache("different-page", slugId, "Invalid cross-page update");
    expect(queryClient.getQueryData<any>(PAGE_QUERY_KEYS.page(id)).content).toBe("Updated content");
  } finally {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
