// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { DatabaseRecordDrawer } from "./database-record-drawer";

const fixture = vi.hoisted(() => ({
  pages: {} as Record<string, any>,
  contexts: {} as Record<string, any>,
  properties: [] as any[],
  mutate: vi.fn(),
  updatePage: vi.fn(),
  emit: vi.fn(),
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/features/page/queries/page-query", () => ({
  usePageQuery: ({ pageId }: { pageId: string }) => ({
    data: fixture.pages[pageId],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  updatePageData: vi.fn(),
}));
vi.mock("@/features/space/queries/space-query", () => ({
  useSpaceQuery: () => ({ data: { settings: {} } }),
}));
vi.mock("../queries/database-table-query", () => ({
  useDatabaseRowContextQuery: (pageId: string) => ({
    data: fixture.contexts[pageId],
    isPending: false,
    isError: false,
  }),
  useDatabasePropertiesQuery: () => ({ data: fixture.properties }),
  useBatchUpdateDatabaseCellsMutation: () => ({ mutate: fixture.mutate }),
}));
vi.mock("@/features/page/services/page-service", () => ({
  updatePage: (...args: unknown[]) => fixture.updatePage(...args),
  getAllSidebarPages: vi.fn(),
}));
vi.mock("@/features/websocket/use-query-emit", () => ({
  useQueryEmit: () => fixture.emit,
}));
vi.mock(
  "@/features/page/components/document-fields/space-member-select-utils",
  async (original) => ({
    ...(await original<
      typeof import("@/features/page/components/document-fields/space-member-select-utils")
    >()),
    useSpaceMemberSelectOptions: () => ({ options: [], knownUsersById: {} }),
  }),
);
vi.mock("@/features/editor/page-editor", () => ({
  default: ({ pageId, editable }: any) => (
    <div
      data-testid="body-editor"
      data-page-id={pageId}
      data-editable={String(editable)}
    />
  ),
}));
vi.mock("@/features/editor/title-editor", () => ({
  TitleEditor: ({ title, pageId, editable }: any) => (
    <div
      data-testid="title-editor"
      data-page-id={pageId}
      data-editable={String(editable)}
    >
      {title}
    </div>
  ),
}));
vi.mock("@/features/user/components/page-state-pref", () => ({
  PageStateSegmentedControl: () => (
    <button data-testid="edit-mode">Edit mode</button>
  ),
}));
vi.mock("@/features/comment/components/page-comment-section", () => ({
  default: () => null,
}));
vi.mock("@/features/page-history/components/history-modal", () => ({
  default: () => null,
}));
vi.mock("./database-cell-renderer", () => ({
  // Retain the real panel's editing state while isolating editor input internals.
  DatabaseCellRenderer: ({
    property,
    value,
    isEditable,
    isEditing,
    editingValue,
    onStartEdit,
    onChange,
  }: any) =>
    !isEditable ? (
      <span data-testid="readonly-property">{String(value)}</span>
    ) : isEditing ? (
      <textarea
        aria-label={property.name}
        value={String(editingValue)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    ) : (
      <button onClick={onStartEdit}>Edit {property.name}</button>
    ),
}));

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const databaseId = "33333333-3333-4333-8333-333333333333";
const propertyId = "44444444-4444-4444-8444-444444444444";
vi.mock("../services/database-service", () => ({
  getDatabaseRows: vi.fn(
    async (_databaseId: string, { neighborOf, neighborDirection }: any) => ({
      items:
        neighborOf === firstId && neighborDirection === "next"
          ? [{ pageId: secondId }]
          : neighborOf === secondId && neighborDirection === "previous"
            ? [{ pageId: firstId }]
            : [],
    }),
  ),
}));

describe("DatabaseRecordDrawer properties and search reveal", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let controls: {
    page: (id: string | null) => void;
    navigate: ReturnType<typeof useNavigate>;
    refresh: () => void;
  };
  let frames: Map<number, FrameRequestCallback>;
  let scrolls: { propertyId?: string; hidden: boolean }[];
  let reveals: { pageId: string; hidden: boolean | undefined }[];
  const onReveal = (event: Event) => {
    const pageId = (event as CustomEvent).detail.pageId;
    const panel = document.getElementById(`record-properties-${pageId}`);
    reveals.push({ pageId, hidden: panel?.hidden });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })),
    });
    frames = new Map();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    scrolls = [];
    reveals = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolls.push({
          propertyId: this.dataset.databasePropertyId,
          hidden: Boolean(this.closest("[hidden]")),
        });
      },
    });
    document.addEventListener("docmost:reveal-search-property", onReveal);
    fixture.properties = [
      {
        id: propertyId,
        name: "Current notes",
        type: "multiline_text",
        databaseId,
        workspaceId: "workspace",
        settings: {},
        position: 0,
      },
    ];
    fixture.pages = Object.fromEntries(
      [firstId, secondId].map((id, index) => [
        id,
        {
          id,
          slugId: `record-${index}`,
          title: `Current record ${index + 1}`,
          workspaceId: "workspace",
          spaceId: "space",
          space: { slug: "space", settings: {} },
          access: { capabilities: { canWrite: true } },
          content: null,
        },
      ]),
    );
    fixture.contexts = Object.fromEntries(
      [firstId, secondId].map((id) => [
        id,
        {
          database: { id: databaseId },
          row: { pageId: id },
          properties: fixture.properties,
          cells: [{ propertyId, value: `Notes for ${id}` }],
        },
      ]),
    );
    fixture.mutate.mockClear();
    fixture.updatePage.mockClear();
    fixture.emit.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    document.removeEventListener("docmost:reveal-search-property", onReveal);
    localStorage.removeItem("currentUser");
    vi.unstubAllGlobals();
  });

  function Harness({ editable }: { editable: boolean }) {
    const [pageId, setPage] = useState<string | null>(firstId);
    const [, refresh] = useState(0);
    controls = {
      page: setPage,
      navigate: useNavigate(),
      refresh: () => refresh((value) => value + 1),
    };
    return (
      <DatabaseRecordDrawer
        pageId={pageId}
        scope={{ databaseId, viewState: {} as any }}
        spaceSlug="space"
        isEditable={editable}
        onNavigate={setPage}
        onClose={() => setPage(null)}
      />
    );
  }
  const render = async (editable = true) => {
    const store = createStore();
    store.set(currentUserAtom, {
      user: { settings: { preferences: { defaultPageEditMode: "edit" } } },
      workspace: {},
    } as any);
    await act(async () =>
      root.render(
        <Provider store={store}>
          <MantineProvider env="test">
            <QueryClientProvider client={client}>
              <MemoryRouter>
                <Harness editable={editable} />
              </MemoryRouter>
            </QueryClientProvider>
          </MantineProvider>
        </Provider>,
      ),
    );
  };
  const button = (text: string) => {
    const item = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((element) => element.textContent?.trim() === text);
    if (!item) throw new Error(`Missing button: ${text}`);
    return item;
  };
  const click = async (text: string) => act(async () => button(text).click());
  const waitEnabled = async (text: string) => {
    for (let attempt = 0; attempt < 20 && button(text).disabled; attempt++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    expect(button(text).disabled).toBe(false);
  };
  const flushFrames = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    });
  const panel = (pageId = firstId) =>
    document.getElementById(`record-properties-${pageId}`)!;

  it("shows the current title once in TitleEditor and retains an unsaved field draft across collapse/reopen", async () => {
    await render();
    expect(
      document.querySelectorAll('[data-testid="title-editor"]'),
    ).toHaveLength(1);
    expect(document.querySelector(".mantine-Drawer-title")?.textContent).toBe(
      "Current record 1",
    );
    fixture.pages[firstId] = {
      ...fixture.pages[firstId],
      title: "Renamed current record",
    };
    await act(async () => controls.refresh());
    expect(document.querySelector(".mantine-Drawer-title")?.textContent).toBe(
      "Renamed current record",
    );
    expect(
      document.querySelector('[data-testid="title-editor"]')?.textContent,
    ).toBe("Renamed current record");
    await click("Edit Current notes");
    const input = panel().querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Unsaved property draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("dbBoard.hideProperties");
    expect(panel().hidden).toBe(true);
    expect(panel().querySelector("textarea")).toBe(input);
    await click("dbBoard.showProperties");
    expect(panel().hidden).toBe(false);
    expect(panel().querySelector("textarea")?.value).toBe(
      "Unsaved property draft",
    );
    expect(fixture.mutate).not.toHaveBeenCalled();
  });

  it("preserves the properties display choice on previous/next and resets it after closing", async () => {
    await render();
    await waitEnabled("Next");
    await click("dbBoard.hideProperties");
    await click("Next");
    expect(panel(secondId).hidden).toBe(true);
    await waitEnabled("dbBoard.previous");
    await click("dbBoard.previous");
    expect(panel().hidden).toBe(true);
    await click("dbBoard.showProperties");
    await waitEnabled("Next");
    await click("Next");
    expect(panel(secondId).hidden).toBe(false);
    await act(async () => controls.page(null));
    await act(async () => controls.page(firstId));
    expect(panel().hidden).toBe(false);
  });

  it("reveals the current property after opening and repeats the same search target without moving focus", async () => {
    await render();
    await click("dbBoard.hideProperties");
    const source = button("dbBoard.showProperties");
    source.focus();
    const path = `/?find=stale%20snippet&findProperty=${propertyId}`;
    await act(async () => controls.navigate(path));
    flushFrames();
    expect(panel().hidden).toBe(false);
    expect(reveals).toContainEqual({ pageId: firstId, hidden: false });
    expect(scrolls).toContainEqual({ propertyId, hidden: false });
    expect(
      panel().querySelector('[data-search-property-target="true"]')
        ?.textContent,
    ).toContain("Current notes");
    expect(panel().textContent).not.toContain("stale snippet");
    expect(panel().querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(source);
    await click("dbBoard.hideProperties");
    scrolls = [];
    reveals = [];
    await act(async () => controls.navigate(path));
    flushFrames();
    expect(panel().hidden).toBe(false);
    expect(reveals).toContainEqual({ pageId: firstId, hidden: false });
    expect(scrolls).toContainEqual({ propertyId, hidden: false });
    expect(document.activeElement).toBe(source);
  });

  it("keeps reader fields, title, content and mode controls read-only after search reveal", async () => {
    await render(false);
    await click("dbBoard.hideProperties");
    await act(async () => controls.navigate(`/?findProperty=${propertyId}`));
    flushFrames();
    expect(panel().hidden).toBe(false);
    expect(
      panel().querySelector('input,textarea,button,[contenteditable="true"]'),
    ).toBeNull();
    expect(document.querySelector('[data-testid="edit-mode"]')).toBeNull();
    expect(
      document
        .querySelector('[data-testid="title-editor"]')
        ?.getAttribute("data-editable"),
    ).toBe("false");
    expect(
      document
        .querySelector('[data-testid="body-editor"]')
        ?.getAttribute("data-editable"),
    ).toBe("false");
    expect(fixture.mutate).not.toHaveBeenCalled();
    expect(fixture.updatePage).not.toHaveBeenCalled();
  });
});
