// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibleActionIcon } from "./accessible-action-icon";

vi.mock("@mantine/core", () => ({
  ActionIcon: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: number | string }
  >(({ children, size, style, ...props }, ref) => (
    <button data-size={size} ref={ref} style={style} type="button" {...props}>
      {children}
    </button>
  )),
  Tooltip: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) => <span data-tooltip={label}>{children}</span>,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderIcon(label: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AccessibleActionIcon label={label}>
        <span aria-hidden="true">Icon</span>
      </AccessibleActionIcon>,
    );
  });

  return { container, root };
}

describe("AccessibleActionIcon", () => {
  let mountedRoot: Root | null = null;
  let mountedContainer: HTMLElement | null = null;

  afterEach(() => {
    if (mountedRoot && mountedContainer) {
      act(() => {
        mountedRoot?.unmount();
      });
      mountedContainer.remove();
    }

    mountedRoot = null;
    mountedContainer = null;
  });

  it("forwards the accessible label and a default hit target", () => {
    const { container, root } = renderIcon("Open actions");
    mountedRoot = root;
    mountedContainer = container;

    const button = container.querySelector("button");

    expect(button?.getAttribute("aria-label")).toBe("Open actions");
    expect(button?.getAttribute("data-size")).toBe("32");
    expect(button?.style.minHeight).toBe("32px");
    expect(button?.style.minWidth).toBe("32px");
  });
});
