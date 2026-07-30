// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useModalBackgroundInert } from "./use-modal-background-inert";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ opened }: { opened: boolean }) {
  useModalBackgroundInert(opened);
  return null;
}

describe("useModalBackgroundInert", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("removes the application root from the accessibility tree while open", () => {
    act(() => root.render(<Harness opened />));

    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(container.hasAttribute("inert")).toBe(true);

    act(() => root.render(<Harness opened={false} />));

    expect(container.hasAttribute("aria-hidden")).toBe(false);
    expect(container.hasAttribute("inert")).toBe(false);
  });
});
