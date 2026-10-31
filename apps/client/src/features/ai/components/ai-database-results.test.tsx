// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AiDatabaseResultCard } from "@docmost/api-contract";
import {
  AiDatabaseResultDetails,
  AiDatabaseResults,
} from "./ai-database-results";

const query = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  data: [] as AiDatabaseResultCard[],
  refetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }));
vi.mock("../services/ai-database-result-service", () => ({
  getAiDatabaseResults: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values?.count === undefined ? "" : ` ${values.count}`}`,
    i18n: { language: "en-US" },
  }),
}));
const card: AiDatabaseResultCard = {
  runId: "run",
  stepId: "step",
  databaseId: "database",
  receipt: {
    version: 1,
    mode: "summary",
    asOf: "2026-10-31T09:00:00Z",
    databasePageId: "page",
    databaseTitle: "Tasks",
    schemaFingerprint: "a".repeat(64),
    selectedRowCount: 2,
    propertyLabels: { budget: "Budget" },
  },
  viewState: {
    version: 2,
    filter: {
      conjunction: "and",
      conditions: [{ propertyId: "budget", operator: "gt", value: 7 }],
    },
    sorts: [{ propertyId: "budget", direction: "desc" }],
    calculations: { budget: "sum" },
    visibleColumns: {},
    columnOrder: ["budget"],
  },
  scope: "accessible_ai_allowed_rows",
  summary: { count: 271, values: { budget: 2710 }, groups: [] },
  returnedRows: 0,
  incomplete: false,
  canOpenRows: true,
  sourceUrl: "/s/test/db/source",
  resultUrl: "/s/test/ai/database-results/run/step",
};
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
});
const render = (content: React.ReactNode) => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  act(() =>
    root.render(
      <MantineProvider>
        <MemoryRouter>{content}</MemoryRouter>
      </MantineProvider>,
    ),
  );
  const html = element.innerHTML;
  act(() => root.unmount());
  element.remove();
  return html;
};

describe("AI database server results", () => {
  it("shows authoritative totals, conditions, selection scope and read time", () => {
    const html = render(<AiDatabaseResultDetails card={card} />);
    expect(html).toContain("2,710");
    expect(html).toContain("ai.database.results.counted 271");
    expect(html).toContain("ai.database.results.selected 2");
    expect(html).toContain("Budget dbTable.gt 7");
    expect(html).toContain("Descending");
    expect(html).toContain("Columns: Title, Budget");
    expect(html).toContain("ai.database.results.asOf");
    expect(html).not.toContain("ai.database.results.incomplete");
  });
  it("identifies incomplete results and prevents summary-only runs from linking to rows", () => {
    query.isError = false;
    query.data = [{ ...card, incomplete: true, canOpenRows: false }];
    const html = render(<AiDatabaseResults runId="run" />);
    expect(html).toContain("ai.database.results.incomplete");
    expect(html).toContain("ai.database.results.queryDisabled");
    expect(html).not.toContain(card.resultUrl);
    expect(html).toContain(card.sourceUrl);
  });
  it("hides cached values when the current request denies access", () => {
    query.data = [card];
    query.isError = true;
    const html = render(<AiDatabaseResults runId="run" />);
    expect(html).toContain("ai.database.results.unavailable");
    expect(html).not.toContain("Tasks");
    expect(html).not.toContain("2,710");
    query.isError = false;
  });
});
