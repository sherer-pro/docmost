// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { DocumentFieldsPanel } from "./document-fields-panel";

const fixture = vi.hoisted(() => ({
  context: null as any,
  properties: [] as any[],
  mutate: vi.fn(),
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/features/database/queries/database-table-query", () => ({
  useDatabaseRowContextQuery: () => ({ data: fixture.context }),
  useDatabasePropertiesQuery: () => ({ data: fixture.properties }),
  useBatchUpdateDatabaseCellsMutation: () => ({ mutate: fixture.mutate }),
}));
vi.mock("@/features/websocket/use-query-emit.ts", () => ({
  useQueryEmit: () => vi.fn(),
}));
vi.mock(
  "@/features/page/components/document-fields/space-member-select-utils.tsx",
  async (original) => ({
    ...(await original<typeof import("./space-member-select-utils")>()),
    useSpaceMemberSelectOptions: () => ({
      options: [],
      knownUsersById: {
        "22222222-2222-4222-8222-222222222222": { label: "Current member" },
      },
    }),
  }),
);
vi.mock("@/features/dictionary/components/dictionary-text-highlighter", () => ({
  DictionaryTextHighlighter: ({ text }: { text: string }) => (
    <span>{text}</span>
  ),
}));

it("renders typed and legacy read-only fields and reveals only the current permitted property", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const targetId = "11111111-1111-4111-8111-111111111111";
  const examples = [
    [
      targetId,
      "Current renamed notes",
      "multiline_text",
      "=SUM current value",
      {},
    ],
    ["zero", "Zero", "number", 0, {}],
    [
      "legacy-zero",
      "Legacy zero",
      "number",
      { value: 0, rawValueBeforeTypeChange: "old" },
      {},
    ],
    ["unchecked", "Unchecked", "checkbox", false, {}],
    ["date", "Date", "date", { start: "2026-11-02", end: "2026-11-03" }, {}],
    [
      "choices",
      "Choices",
      "multi_select",
      { value: ["red", "blue"], rawValueBeforeTypeChange: "old" },
      {
        options: [
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
        ],
      },
    ],
    [
      "user",
      "Members",
      "user",
      [{ id: "22222222-2222-4222-8222-222222222222", name: "Current member" }],
      {},
    ],
    [
      "file",
      "Files",
      "file",
      [
        {
          attachmentId: "33333333-3333-4333-8333-333333333333",
          name: "Report.pdf",
        },
      ],
      {},
    ],
    [
      "error",
      "Formula",
      "formula",
      { error: "division_by_zero" },
      { resultType: "number", expression: "1 / 0", languageVersion: 1 },
    ],
  ];
  fixture.properties = examples.map(
    ([id, name, type, , settings], position) => ({
      id,
      name,
      type,
      settings,
      position,
      databaseId: "database",
    }),
  );
  fixture.context = {
    database: { id: "database" },
    row: { pageId: "page" },
    properties: fixture.properties,
    cells: examples.map(([propertyId, , , value]) => ({ propertyId, value })),
  };
  fixture.mutate.mockClear();
  const page = {
    id: "page",
    workspaceId: "workspace",
    spaceId: "space",
    space: { slug: "space", settings: {} },
  } as any;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    act(() =>
      root.render(
        <MemoryRouter
          initialEntries={[`/?find=old%20snippet&findProperty=${targetId}`]}
        >
          <QueryClientProvider client={client}>
            <MantineProvider>
              <DocumentFieldsPanel page={page} readOnly />
            </MantineProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    );
  try {
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("=SUM current value");
    expect(text).toContain("Current renamed notes");
    expect(text).not.toContain("old snippet");
    expect(text).toContain("Red");
    expect(text).toContain("Blue");
    expect(text).toContain("Nov 2");
    expect(text).toContain("Current member");
    expect(text).toContain("Report.pdf");
    expect(text).toContain("dbTable.formulaErrors.division_by_zero");
    expect(
      container.querySelector('[data-database-property-id="zero"]')
        ?.textContent,
    ).toContain("0");
    expect(
      container.querySelector('[data-database-property-id="legacy-zero"]')
        ?.textContent,
    ).toContain("0");
    expect(
      container.querySelectorAll(
        'input:not([disabled]), textarea, [role="combobox"]',
      ),
    ).toHaveLength(0);
    expect(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(false);
    const target = container.querySelector(
      '[data-search-property-target="true"]',
    );
    expect(target?.getAttribute("data-database-property-id")).toBe(targetId);
    expect(scroll).toHaveBeenCalled();
    scroll.mockClear();
    document.dispatchEvent(
      new CustomEvent("docmost:reveal-search-property", {
        detail: { pageId: "other-page" },
      }),
    );
    expect(scroll).not.toHaveBeenCalled();
    document.dispatchEvent(
      new CustomEvent("docmost:reveal-search-property", {
        detail: { pageId: page.id },
      }),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(target);
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fixture.mutate).not.toHaveBeenCalled();
    fixture.properties = fixture.properties.filter(
      (property) => property.id !== targetId,
    );
    fixture.context = { ...fixture.context, properties: fixture.properties };
    scroll.mockClear();
    render();
    expect(
      container.querySelector('[data-search-property-target="true"]'),
    ).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
