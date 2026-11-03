// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useSearchSuggestionsQuery } from "./search-query";
import { searchSuggestions } from "../services/search-service";

vi.mock("../services/search-service", () => ({
  searchSuggestions: vi.fn(async () => ({
    users: [{ id: "author", name: "Ada" }],
  })),
}));

it("does not request authors for empty or whitespace input and separates nonempty requests by space", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({ query, spaceId }: { query: string; spaceId: string }) {
    const result = useSearchSuggestionsQuery({
      query,
      spaceId,
      includeUsers: true,
    });
    return <output>{result.data?.users?.[0]?.name}</output>;
  }
  const render = async (query: string, spaceId = "first") => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe query={query} spaceId={spaceId} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  try {
    vi.mocked(searchSuggestions).mockClear();
    await render("");
    await render(" \t ");
    expect(searchSuggestions).not.toHaveBeenCalled();
    await render("Ada");
    expect(searchSuggestions).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Ada");
    await render("");
    expect(searchSuggestions).toHaveBeenCalledTimes(1);
    await render("Ada", "second");
    expect(searchSuggestions).toHaveBeenCalledTimes(2);
    expect(searchSuggestions).toHaveBeenLastCalledWith({
      query: "Ada",
      spaceId: "second",
      includeUsers: true,
    });
  } finally {
    act(() => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});
