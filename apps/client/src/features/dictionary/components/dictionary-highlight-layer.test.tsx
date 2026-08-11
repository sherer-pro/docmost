// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictionaryHighlightLayer } from "./dictionary-highlight-layer";
import type { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";

vi.mock("@mantine/core", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@mantine/hooks", () => ({
  useDisclosure: () => [false, { open: vi.fn(), close: vi.fn() }],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("./dictionary-markdown", () => ({
  DictionaryMarkdown: () => <div data-testid="definition" />,
}));

vi.mock("./dictionary-term-modal", () => ({
  DictionaryTermModal: () => null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const term: IDictionaryTerm = {
  id: "term-1",
  spaceId: "space-1",
  workspaceId: "workspace-1",
  term: "Alpha",
  forms: [],
  definitionMarkdown: "Definition",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("DictionaryHighlightLayer", () => {
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

  it.each(["Enter", " "])("prevents %s from reaching the editor", (key) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const editorKeyDown = vi.fn();

    act(() => {
      root?.render(
        <div onKeyDown={editorKeyDown}>
          <DictionaryHighlightLayer terms={[term]}>
            <span
              className="dictionary-highlight"
              data-dictionary-term-id="term-1"
              tabIndex={0}
            >
              Alpha
            </span>
          </DictionaryHighlightLayer>
        </div>,
      );
    });

    const highlight = container.querySelector<HTMLElement>(
      ".dictionary-highlight",
    );
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });

    act(() => highlight?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(editorKeyDown).not.toHaveBeenCalled();
  });

  it("exposes a focused definition as an associated tooltip", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DictionaryHighlightLayer terms={[term]}>
          <span
            className="dictionary-highlight"
            data-dictionary-term-id="term-1"
            role="button"
            tabIndex={0}
          >
            Alpha
          </span>
        </DictionaryHighlightLayer>,
      );
    });

    const highlight = container.querySelector<HTMLElement>(
      ".dictionary-highlight",
    );

    await act(async () => highlight?.focus());

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(document.activeElement).toBe(highlight);
  });

  it("shows the definition before editor handlers stop event bubbling", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DictionaryHighlightLayer terms={[term]}>
          <span
            className="dictionary-highlight"
            data-dictionary-term-id="term-1"
            role="button"
            tabIndex={0}
          >
            Alpha
          </span>
        </DictionaryHighlightLayer>,
      );
    });

    const highlight = container.querySelector<HTMLElement>(
      ".dictionary-highlight",
    );
    highlight?.addEventListener("mouseover", (event) =>
      event.stopPropagation(),
    );

    await act(async () => {
      highlight?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  });
});
