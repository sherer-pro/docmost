// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictionaryMarkdown } from "./dictionary-markdown";

vi.mock("@mantine/core", () => ({
  Box: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DictionaryMarkdown", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
  });

  it("sanitizes HTML in a dictionary definition", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <DictionaryMarkdown
          markdown={
            '<img src="x" onerror="alert(1)"><script>alert(2)</script>Safe'
          }
        />,
      );
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(container.textContent).toContain("Safe");
  });
});
