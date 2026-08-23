// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NodeViewProps } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransclusionReferenceView from "./transclusion-reference-view";
import TransclusionView from "./transclusion-view";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { as?: string }
  >(({ as: _as, ...props }, ref) => <div ref={ref} {...props} />),
  NodeViewContent: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-node-view-content {...props} />
  ),
}));

vi.mock("@mantine/core", () => {
  const ActionIcon = ({
    children,
    color: _color,
    component: _component,
    loading: _loading,
    size: _size,
    to: _to,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Record<string, unknown>) => <button {...props}>{children}</button>;
  const Menu = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const MenuPart = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const MenuItem = ({
    children,
    color: _color,
    leftSection: _leftSection,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Record<string, unknown>) => (
    <button role="menuitem" {...props}>
      {children}
    </button>
  );

  Object.assign(Menu, {
    Dropdown: MenuPart,
    Item: MenuItem,
    Label: MenuPart,
    Target: MenuPart,
  });

  return {
    ActionIcon,
    Menu,
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("@tabler/icons-react", () => ({
  IconCheck: () => null,
  IconCopy: () => null,
  IconDots: () => null,
  IconLinkOff: () => null,
  IconPencil: () => null,
  IconRefresh: () => null,
  IconTrash: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("react-router-dom", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@docmost/editor-ext", () => ({
  getTransclusionReferenceKey: (sourcePageId: string, transclusionId: string) =>
    `${sourcePageId}:${transclusionId}`,
}));

vi.mock("@/features/page/page.utils", () => ({
  buildPageUrl: () => "/source",
}));

vi.mock("@/features/editor/extensions/transclusion-clipboard", () => ({
  buildSyncedBlockClipboardPayload: vi.fn(() => ({})),
  writeTransclusionClipboard: vi.fn(async () => undefined),
}));

vi.mock("@/features/editor/extensions/transclusion-deletion-guard", () => ({}));

vi.mock("@/features/transclusion/queries/transclusion-query", () => ({
  useReferencesQuery: () => ({
    data: { hasReferences: false, source: null },
    isError: false,
  }),
  useUnsyncReferenceMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock(
  "@/features/transclusion/components/sync-block-references-dropdown",
  () => ({
    default: ({ currentPageId }: { currentPageId: string }) => (
      <span data-current-page-id={currentPageId} data-testid="references" />
    ),
  }),
);

vi.mock("./use-transclusion-lookup", () => ({
  useTransclusionLookup: () => ({
    result: { content: { type: "doc" }, sourceUpdatedAt: "2026-08-23" },
    refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock("./use-transclusion-viewport", () => ({
  useTransclusionViewport: () => ({
    viewportRef: { current: null },
    isNearViewport: true,
  }),
}));

vi.mock("./transclusion-content", () => ({
  default: () => <div data-testid="transclusion-content" />,
}));

vi.mock("./error-placeholder", () => ({ default: () => null }));
vi.mock("./no-access-placeholder", () => ({ default: () => null }));
vi.mock("./not-found-placeholder", () => ({ default: () => null }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("transclusion page-id lifecycle", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("enables source copy after the host assigns its page id on create", async () => {
    const runtime = createEditorRuntime();
    render(
      <TransclusionView
        {...nodeViewProps(runtime.editor, { id: "transclusion-1" })}
      />,
    );

    expect(copyButton().disabled).toBe(true);
    expect(references()).toBeNull();

    await runtime.assignPageId("source-page");

    expect(copyButton().disabled).toBe(false);
    expect(references()?.dataset.currentPageId).toBe("source-page");
  });

  it("enables reference host controls after the host page id becomes available", async () => {
    const runtime = createEditorRuntime();
    render(
      <TransclusionReferenceView
        {...nodeViewProps(runtime.editor, {
          sourcePageId: "source-page",
          transclusionId: "transclusion-1",
        })}
      />,
    );

    expect(unsyncButton().disabled).toBe(true);
    expect(references()).toBeNull();

    await runtime.assignPageId("reference-page");

    expect(unsyncButton().disabled).toBe(false);
    expect(references()?.dataset.currentPageId).toBe("reference-page");
  });

  function render(view: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(view));
  }

  function copyButton() {
    return container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy synced block"]',
    )!;
  }

  function unsyncButton() {
    return Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent === "Unsync")!;
  }

  function references() {
    return container!.querySelector<HTMLElement>('[data-testid="references"]');
  }
});

function createEditorRuntime() {
  const handlers = new Map<string, Set<() => void>>();
  const editor = {
    isEditable: true,
    storage: {
      transclusionClipboard: { items: new Map() },
      transclusionDeletionGuard: { sourceStates: new Map() },
    } as Record<string, unknown> & { pageId?: string },
    on: vi.fn((event: string, handler: () => void) => {
      const eventHandlers = handlers.get(event) ?? new Set<() => void>();
      eventHandlers.add(handler);
      handlers.set(event, eventHandlers);
    }),
    off: vi.fn((event: string, handler: () => void) => {
      handlers.get(event)?.delete(handler);
    }),
  };

  return {
    editor,
    async assignPageId(pageId: string) {
      await act(async () => {
        editor.storage.pageId = pageId;
        handlers.get("create")?.forEach((handler) => handler());
        await Promise.resolve();
      });
    },
  };
}

function nodeViewProps(
  editor: ReturnType<typeof createEditorRuntime>["editor"],
  attrs: Record<string, unknown>,
) {
  return {
    deleteNode: vi.fn(),
    editor,
    extension: { options: { getContentExtensions: () => [] } },
    getPos: () => 0,
    node: { attrs, content: { size: 0 }, nodeSize: 1 },
    selected: false,
  } as unknown as NodeViewProps;
}
