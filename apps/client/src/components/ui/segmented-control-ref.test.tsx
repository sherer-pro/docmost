// @vitest-environment jsdom
import React, { act, Suspense, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, SegmentedControl } from "@mantine/core";
import { expect, it, vi } from "vitest";

it("preserves the segmented control DOM reference when its selected value changes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const nodes: Array<HTMLDivElement | null> = [];
  function Control() {
    const [value, setValue] = useState("read");
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const ref = useCallback((node: HTMLDivElement | null) => {
      nodes.push(node);
      setElement(node);
    }, []);
    return <>
      <SegmentedControl ref={ref} data={["read", "edit"]} value={value} onChange={setValue} />
      <button onClick={() => setValue("edit")}>Edit</button>
      <output>{element?.tagName}:{value}</output>
    </>;
  }
  try {
    act(() => root.render(<MantineProvider env="test"><Control /></MantineProvider>));
    const original = container.querySelector('[role="radiogroup"]');
    nodes.length = 0;
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector("output")?.textContent).toBe("DIV:edit");
    expect(container.querySelector('[role="radiogroup"]')).toBe(original);
    expect(nodes).toEqual([]);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("can hide a segmented control behind a Suspense fallback without ref update recursion", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const pending = new Promise(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Pending({ active }: { active: boolean }) {
    if (active) throw pending;
    return null;
  }
  function Control() {
    const [active, setActive] = useState(false);
    return <>
      <button onClick={() => setActive(true)}>Suspend</button>
      <Suspense fallback={<p>Loading controls</p>}>
        <SegmentedControl data={["read", "edit"]} value="read" />
        <Pending active={active} />
      </Suspense>
    </>;
  }
  try {
    act(() => root.render(<MantineProvider env="test"><Control /></MantineProvider>));
    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Loading controls");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
