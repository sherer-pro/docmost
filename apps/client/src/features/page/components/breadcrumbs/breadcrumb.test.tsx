// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import Breadcrumb from "./breadcrumb";

const query = vi.hoisted(() => ({ renders: 0, title: "Record database" }));
vi.mock("@/features/page/queries/page-query.ts", () => ({
  usePageQuery: () => {
    if (++query.renders > 20) throw Error("Breadcrumb update loop");
    return { data: { id: "current", slugId: "current", title: query.title } };
  },
  usePageBreadcrumbsQuery: () => ({ data: [
    { id: "parent", slugId: "parent", title: "Parent", parentPageId: null },
    { id: "current", slugId: "current", title: query.title, parentPageId: "parent" },
  ] }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("renders fresh breadcrumb snapshots without scheduling a self-update loop", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(<MantineProvider env="test"><MemoryRouter initialEntries={["/s/test/p/current"]}>
    <Routes><Route path="/s/:spaceSlug/p/:pageSlug" element={<Breadcrumb />} /></Routes>
  </MemoryRouter></MantineProvider>);
  query.renders = 0;
  try {
    act(render);
    expect(container.textContent).toContain("Parent");
    expect(container.textContent).toContain("Record database");
    expect(query.renders).toBeLessThan(5);
    query.title = "Renamed database";
    act(render);
    expect(container.textContent).toContain("Renamed database");
    expect(container.textContent).not.toContain("Record database");
    expect(query.renders).toBeLessThan(8);
  } finally {
    act(() => root.unmount());
    container.remove();
    query.title = "Record database";
    vi.unstubAllGlobals();
  }
});
