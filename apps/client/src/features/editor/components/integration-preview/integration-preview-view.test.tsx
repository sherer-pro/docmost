// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import IntegrationPreviewView from "./integration-preview-view";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("jotai", () => ({
  useAtomValue: () => ({ user: { id: "synthetic-viewer" } }),
}));
vi.mock("@/features/user/atoms/current-user-atom", () => ({
  currentUserAtom: {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/features/integration-preview/integration-preview-service", () => ({
  resolveIntegrationPreview: vi.fn(async () => ({
    status: "ready",
    title: "Authorized title",
  })),
}));
import { resolveIntegrationPreview } from "@/features/integration-preview/integration-preview-service";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe("integration preview editor lifecycle", () => {
  it("loads metadata when page identity is assigned after the node view mounts", async () => {
    const handlers = new Set<() => void>();
    const editor = {
      storage: {} as { pageId?: string },
      on: (_name: string, handler: () => void) => handlers.add(handler),
      off: (_name: string, handler: () => void) => handlers.delete(handler),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const url = "https://github.com/private/project/issues/2";
    try {
      await act(async () => {
        root.render(
          <MantineProvider>
            <QueryClientProvider client={client}>
              <MemoryRouter>
                <IntegrationPreviewView
                  {...({
                    editor,
                    selected: false,
                    node: {
                      type: { name: "integrationPreview" },
                      attrs: { url },
                    },
                  } as any)}
                />
              </MemoryRouter>
            </QueryClientProvider>
          </MantineProvider>,
        );
        await Promise.resolve();
      });
      expect(resolveIntegrationPreview).not.toHaveBeenCalled();
      await act(async () => {
        editor.storage.pageId = "synthetic-page";
        for (const handler of handlers) handler();
        await Promise.resolve();
      });
      expect(resolveIntegrationPreview).toHaveBeenCalledWith(
        "synthetic-page",
        url,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(container.textContent).toContain("Authorized title");
    } finally {
      act(() => root.unmount());
      client.clear();
      container.remove();
    }
    expect(handlers.size).toBe(0);
  });
});
