// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import { DictionaryTextHighlighter } from "./dictionary-text-highlighter";

vi.mock("./dictionary-highlight-layer", () => ({
  DictionaryHighlightLayer: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

describe("DictionaryTextHighlighter", () => {
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

  it("renders non-editor highlights as keyboard buttons", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<DictionaryTextHighlighter text="Alpha" terms={[term]} />);
    });

    const highlight = container.querySelector<HTMLElement>(
      ".dictionary-highlight",
    );
    expect(highlight?.tabIndex).toBe(0);
    expect(highlight?.getAttribute("role")).toBe("button");
  });
});
