// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiReasoningDisclosure } from "./ai-reasoning-disclosure";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "Reasoning" }),
}));

vi.mock("@mantine/hooks", () => ({
  useReducedMotion: () => false,
}));

vi.mock("@tabler/icons-react", () => ({
  IconChevronDown: () => <span aria-hidden="true">down</span>,
  IconChevronRight: () => <span aria-hidden="true">right</span>,
}));

vi.mock("@mantine/core", () => ({
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
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
  Collapse: ({
    children,
    in: opened,
  }: {
    children: React.ReactNode;
    in: boolean;
  }) => (opened ? <div>{children}</div> : null),
}));

vi.mock("@/features/ai/utils/ai-markdown.ts", () => ({
  sanitizeAiMarkdown: (value: string) => `<p>${value}</p>`,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AiReasoningDisclosure", () => {
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

  it("is collapsed by default and reveals sanitized reasoning on click", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<AiReasoningDisclosure reasoning="Model reasoning" />);
    });

    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="region"]')).toBeNull();

    act(() => button?.click());

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="region"]')?.textContent).toContain(
      "Model reasoning",
    );
  });
});
