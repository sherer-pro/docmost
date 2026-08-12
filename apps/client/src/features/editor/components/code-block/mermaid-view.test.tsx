// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import MermaidView from "./mermaid-view";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { colorSchemeMock, mermaidInitializeMock, mermaidRenderMock } =
  vi.hoisted(() => ({
    colorSchemeMock: { current: "light" },
    mermaidInitializeMock: vi.fn(),
    mermaidRenderMock: vi.fn(),
  }));

vi.mock("mermaid", () => ({
  default: {
    initialize: mermaidInitializeMock,
    render: mermaidRenderMock,
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "mermaid-test-id"),
}));

vi.mock("@mantine/core", () => ({
  ActionIcon: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Modal: ({
    children,
    opened,
  }: {
    children: React.ReactNode;
    opened: boolean;
  }) => (opened ? children : null),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  useComputedColorScheme: () => colorSchemeMock.current,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

function createProps({
  isEditable,
  textContent,
}: {
  isEditable: boolean;
  textContent: string;
}) {
  return {
    editor: { isEditable },
    node: { textContent },
  } as any;
}

async function renderView(root: Root, props: any) {
  await act(async () => {
    root.render(<MermaidView props={props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("MermaidView", () => {
  let mountedRoot: Root | null = null;
  let mountedContainer: HTMLElement | null = null;

  afterEach(() => {
    mermaidInitializeMock.mockClear();
    mermaidRenderMock.mockReset();
    colorSchemeMock.current = "light";

    if (mountedRoot && mountedContainer) {
      act(() => {
        mountedRoot?.unmount();
      });
      mountedContainer.remove();
    }

    mountedRoot = null;
    mountedContainer = null;
  });

  it("does not render Mermaid again when only editor editability changes", async () => {
    mermaidRenderMock.mockResolvedValue({
      svg: "<svg><text>Rendered diagram</text></svg>",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    const node = { textContent: "graph TD; A-->B" };

    await renderView(root, {
      editor: { isEditable: false },
      node,
    } as any);

    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Rendered diagram");
    expect(mermaidInitializeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
      }),
    );

    await renderView(root, {
      editor: { isEditable: true },
      node,
    } as any);

    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Rendered diagram");
  });

  it("updates the error label for editability changes without rendering again", async () => {
    mermaidRenderMock.mockRejectedValue(new Error("broken diagram"));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    const textContent = "graph TD; C-->D";

    await renderView(
      root,
      createProps({
        isEditable: false,
        textContent,
      }),
    );

    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Invalid Mermaid diagram");

    await renderView(
      root,
      createProps({
        isEditable: true,
        textContent,
      }),
    );

    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Mermaid diagram error:");
    expect(container.textContent).toContain("Error: broken diagram");
  });

  it("sanitizes rendered SVG and opens the read-only preview from the keyboard", async () => {
    mermaidRenderMock.mockResolvedValue({
      svg: "<svg><script>alert(1)</script><text>Safe diagram</text></svg>",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await renderView(
      root,
      createProps({
        isEditable: false,
        textContent: "graph TD; SAFE-->PREVIEW",
      }),
    );

    expect(container.innerHTML).not.toContain("<script");
    expect(container.textContent).toContain("Safe diagram");

    const interactive = container.querySelector('[role="button"]');
    expect(interactive).toBeTruthy();
    await act(async () => {
      interactive?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent?.match(/Safe diagram/gu)).toHaveLength(2);
  });
});
