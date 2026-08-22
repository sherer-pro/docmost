// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncQueryState, type AsyncQueryStateKind } from "./async-query-state";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@mantine/core", () => ({
  Button: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Center: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Loader: () => <span>loader</span>,
}));

vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: () => null,
  IconInbox: () => null,
}));

vi.mock("./empty-state", () => ({
  EmptyState: ({ title, action }: any) => (
    <div>
      <span>{title}</span>
      {action}
    </div>
  ),
}));

describe("AsyncQueryState", () => {
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

  function renderState(state: AsyncQueryStateKind, onRetry = vi.fn()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <AsyncQueryState
          state={state}
          loadingLabel="Loading spaces"
          errorTitle="Could not load spaces"
          emptyTitle="No spaces"
          retryLabel="Try again"
          onRetry={onRetry}
        >
          <span>spaces table</span>
        </AsyncQueryState>,
      );
    });
    return { container, onRetry };
  }

  it("keeps loading, error, empty, and ready states distinct", () => {
    expect(renderState("loading").container.textContent).toContain("loader");
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    const error = renderState("error");
    expect(error.container.textContent).toContain("Could not load spaces");
    act(() => error.container.querySelector("button")?.click());
    expect(error.onRetry).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    expect(renderState("empty").container.textContent).toContain("No spaces");
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    expect(renderState("ready").container.textContent).toContain(
      "spaces table",
    );
  });
});
