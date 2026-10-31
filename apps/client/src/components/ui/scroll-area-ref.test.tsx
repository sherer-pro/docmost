// @vitest-environment jsdom
import React, { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, ScrollArea } from "@mantine/core";
import { expect, it, vi } from "vitest";

it.each(["root", "scrollbar"])("keeps the scroll area %s reference attached during a parent update", (part) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const rootNodes: Array<HTMLElement | null> = [];
  const scrollbarNodes: Array<HTMLElement | null> = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Control() {
    const [value, setValue] = useState(0);
    const rootRef = useCallback((node: HTMLElement | null) => { rootNodes.push(node); }, []);
    const scrollbarRef = useCallback((node: HTMLElement | null) => { scrollbarNodes.push(node); }, []);
    return <>
      <ScrollArea ref={rootRef} type="always" scrollbars="xy" h={100}
        attributes={{ scrollbar: { ref: scrollbarRef } } as any}>
        <div style={{ width: 500, height: 500 }}>{value}</div>
      </ScrollArea>
      <button onClick={() => setValue((previous) => previous + 1)}>Update</button>
    </>;
  }
  try {
    act(() => root.render(<MantineProvider env="test"><Control /></MantineProvider>));
    expect(container.querySelectorAll(".mantine-ScrollArea-scrollbar")).toHaveLength(2);
    expect(scrollbarNodes.some(Boolean)).toBe(true);
    rootNodes.length = 0;
    scrollbarNodes.length = 0;
    act(() => container.querySelector("button")!.click());
    expect(part === "root" ? rootNodes : scrollbarNodes).toEqual([]);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
