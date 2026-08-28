// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiComposerShell } from "./ai-composer-shell";

vi.mock("@mantine/core", () => ({
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AiComposerShell", () => {
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

  it("keeps context, editor, command palette, and footer in one shell", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <AiComposerShell
          contextRail={<div data-testid="context">Context · 3</div>}
          editor={<div data-testid="editor">Editor</div>}
          commandPalette={<div role="listbox">Commands</div>}
        >
          <div data-testid="footer">Footer</div>
        </AiComposerShell>,
      );
    });

    expect(container.querySelector('[data-testid="context"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="footer"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="ai-composer-context-rail"]'),
    ).not.toBeNull();
  });

  it("omits optional regions without leaving empty wrappers", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <AiComposerShell editor={<div>Editor</div>}>
          <div>Footer</div>
        </AiComposerShell>,
      );
    });

    expect(
      container.querySelector('[data-testid="ai-composer-context-rail"]'),
    ).toBeNull();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
