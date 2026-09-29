// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpaceMemberSelectOptions } from "./space-member-select-utils";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/features/space/services/space-service.ts", () => ({
  getSpaceMemberUsers: vi.fn(),
}));

vi.mock("@/features/page/services/page-service.ts", () => ({
  resolveReferencedUsers: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const formerId = "11111111-1111-4111-8111-111111111111";
const activeId = "22222222-2222-4222-8222-222222222222";

function OptionsProbe({ selectedIds }: { selectedIds: string[] }) {
  const { options, knownUsersById } = useSpaceMemberSelectOptions(
    "space-1",
    selectedIds,
    { pageId: "page-1" },
  );

  return (
    <div>
      <span data-options>{options.map((option) => option.value).join(",")}</span>
      <span data-former-name>{knownUsersById[formerId]?.label}</span>
      <span data-former-avatar>{knownUsersById[formerId]?.avatarUrl}</span>
    </div>
  );
}

describe("space member options with saved references", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("keeps a former member visible only while the reference is selected", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(["spaceMemberUsers", "space-1", ""], {
      items: [{ id: activeId, name: "Active User", avatarUrl: "/active" }],
    });
    queryClient.setQueryData(["pageReferencedUsers", "page-1", [formerId]], [
      { id: formerId, name: "Former User", avatarUrl: "/former" },
    ]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <OptionsProbe selectedIds={[formerId]} />
        </QueryClientProvider>,
      );
    });

    expect(container.querySelector("[data-options]")?.textContent).toBe(
      `${formerId},${activeId}`,
    );
    expect(container.querySelector("[data-former-name]")?.textContent).toBe(
      "Former User",
    );
    expect(container.querySelector("[data-former-avatar]")?.textContent).toBe(
      "/former",
    );

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <OptionsProbe selectedIds={[]} />
        </QueryClientProvider>,
      );
    });

    expect(container.querySelector("[data-options]")?.textContent).toBe(activeId);
  });
});
