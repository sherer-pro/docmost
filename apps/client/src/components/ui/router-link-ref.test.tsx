// @vitest-environment jsdom
import React, { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { expect, it, vi } from "vitest";

it("keeps a stateful floating reference attached while changing only the URL query", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const nodes: Array<HTMLAnchorElement | null> = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function FloatingLink() {
    const [reference, setReference] = useState<HTMLAnchorElement | null>(null);
    const location = useLocation();
    const navigate = useNavigate();
    const ref = useCallback((node: HTMLAnchorElement | null) => {
      nodes.push(node);
      setReference(node);
    }, []);
    return (
      <>
        <Link ref={ref} to="/target">
          Target
        </Link>
        <output>
          {reference?.tagName}:{location.search}
        </output>
        <button onClick={() => navigate("?record=selected")}>
          Open record
        </button>
      </>
    );
  }
  try {
    act(() =>
      root.render(
        <MemoryRouter>
          <FloatingLink />
        </MemoryRouter>,
      ),
    );
    const original = container.querySelector("a");
    nodes.length = 0;
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector("output")?.textContent).toBe(
      "A:?record=selected",
    );
    expect(container.querySelector("a")).toBe(original);
    expect(nodes).toEqual([]);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
