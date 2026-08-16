// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NodeViewProps } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TagView from "./tag-view";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    as: _as,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { as?: string }) => (
    <span {...props} />
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TagView accessibility", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("exposes keyboard-accessible tag descriptions", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const props = {
      node: { attrs: { value: "todo" } },
      selected: false,
      extension: { options: {} },
    } as unknown as NodeViewProps;

    act(() => {
      root?.render(<TagView {...props} />);
    });

    const tag = container.querySelector<HTMLElement>('[data-tag-value="todo"]');
    expect(tag?.tabIndex).toBe(0);
    expect(tag?.getAttribute("role")).toBe("button");

    act(() => tag?.focus());

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.id).toBeTruthy();
    expect(tag?.getAttribute("aria-describedby")).toBe(tooltip?.id);
  });

  it("offers a search action when the editor provides one", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onSearch = vi.fn();
    const props = {
      node: { attrs: { value: "todo" } },
      selected: false,
      extension: { options: { onSearch } },
    } as unknown as NodeViewProps;

    act(() => root?.render(<TagView {...props} />));
    const tag = container.querySelector<HTMLElement>('[data-tag-value="todo"]');
    act(() => tag?.focus());

    const action = document.querySelector<HTMLButtonElement>("button");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(action?.textContent).toBe("Find this tag in the space");
    expect(tag?.getAttribute("aria-haspopup")).toBe("dialog");

    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    act(() => {
      tag?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(action);
    requestAnimationFrame.mockRestore();

    act(() => action?.click());
    expect(onSearch).toHaveBeenCalledWith("todo");
  });
});
