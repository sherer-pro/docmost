// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiComposerShell } from "./ai-composer-shell";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "ai.spaceSearchToggle": "Search the space",
        "ai.composer.spaceSearchShort": "Search",
        "ai.composer.mode": "Assistant mode",
        "ai.composer.chat": "Chat",
        "ai.agent.mode": "Agent",
        "ai.agent.modeDescription": "Agent mode description",
      })[key] ?? key,
  }),
}));

vi.mock("@tabler/icons-react", () => ({
  IconSearch: () => <span aria-hidden="true">search</span>,
}));

vi.mock("@mantine/core", () => ({
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Group: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Button: ({
    children,
    leftSection,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    leftSection?: React.ReactNode;
  }) => (
    <button type="button" {...props}>
      {leftSection}
      {children}
    </button>
  ),
  SegmentedControl: ({
    value,
    disabled,
    data,
    onChange,
    ...props
  }: {
    value: string;
    disabled?: boolean;
    data: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <div role="group" {...props}>
      {data.map((item) => (
        <button
          key={item.value}
          type="button"
          disabled={disabled}
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof AiComposerShell>> = {},
) {
  const onAgentModeChange = vi.fn();
  const onSpaceSearchChange = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AiComposerShell
        contextControl={<button type="button">Context В· 3</button>}
        editor={<div data-testid="editor">Editor</div>}
        agentAvailable
        agentMode={false}
        spaceSearchAvailable
        spaceSearchEnabled={false}
        settingsDisabled={false}
        onAgentModeChange={onAgentModeChange}
        onSpaceSearchChange={onSpaceSearchChange}
        {...overrides}
      >
        <div data-testid="footer">Footer</div>
      </AiComposerShell>,
    );
  });

  return { container, root, onAgentModeChange, onSpaceSearchChange };
}

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

  it("keeps context, editor, footer, search, and mode controls in one shell", () => {
    const rendered = renderComposer();
    root = rendered.root;
    container = rendered.container;

    expect(container.textContent).toContain("Context В· 3");
    expect(container.textContent).toContain("Editor");
    expect(container.textContent).toContain("Footer");
    expect(
      container.querySelector('button[aria-label="Search the space"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Assistant mode"]'),
    ).not.toBeNull();
  });

  it("exposes search as a pressed toggle and switches assistant mode", () => {
    const rendered = renderComposer({ spaceSearchEnabled: true });
    root = rendered.root;
    container = rendered.container;

    const search = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Search the space"]',
    );
    expect(search?.getAttribute("aria-pressed")).toBe("true");
    act(() => search?.click());
    expect(rendered.onSpaceSearchChange).toHaveBeenCalledWith(false);

    const agent = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Agent",
    );
    act(() => agent?.click());
    expect(rendered.onAgentModeChange).toHaveBeenCalledWith(true);
  });

  it("hides unavailable controls and disables context-changing controls", () => {
    const rendered = renderComposer({
      agentAvailable: false,
      spaceSearchAvailable: true,
      settingsDisabled: true,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.textContent).not.toContain("Agent");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Search the space"]',
      )?.disabled,
    ).toBe(true);
  });
});
