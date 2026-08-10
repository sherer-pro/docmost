// @vitest-environment jsdom

import React, { act } from "react";
import type { Editor } from "@tiptap/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedToolbar } from "./fixed-toolbar";

const { aiSelectionActionMock, editorStateMock } = vi.hoisted(() => ({
  aiSelectionActionMock: vi.fn(),
  editorStateMock: vi.fn(),
}));

vi.mock("@tiptap/react", () => ({
  useEditorState: editorStateMock,
}));

vi.mock("@docmost/editor-ext", () => ({
  isTextRangeSelected: () => true,
}));

vi.mock("jotai", () => ({
  atom: vi.fn(),
  useAtom: () => [null, vi.fn()],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("uuid", () => ({
  v7: () => "comment-id",
}));

vi.mock("@tabler/icons-react", () => {
  const Icon = () => <span aria-hidden="true" />;
  return {
    IconBook2: Icon,
    IconCheckbox: Icon,
    IconIndentDecrease: Icon,
    IconIndentIncrease: Icon,
    IconList: Icon,
    IconListNumbers: Icon,
    IconMessage: Icon,
    IconPageBreak: Icon,
    IconRefresh: Icon,
  };
});

vi.mock("@mantine/core", () => {
  const ActionIcon = Object.assign(
    ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    {
      Group: ({ children }: { children?: React.ReactNode }) => (
        <div>{children}</div>
      ),
    },
  );

  return {
    ActionIcon,
    Tooltip: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

vi.mock("@/features/dictionary/components/dictionary-term-modal", () => ({
  DictionaryTermModal: () => null,
}));

vi.mock("@/features/editor/components/bubble-menu/color-selector", () => ({
  ColorSelector: () => null,
}));

vi.mock("@/features/editor/components/bubble-menu/link-selector", () => ({
  LinkSelector: () => null,
}));

vi.mock("@/features/editor/components/bubble-menu/node-selector", () => ({
  NodeSelector: () => null,
}));

vi.mock(
  "@/features/editor/components/bubble-menu/text-alignment-selector",
  () => ({
    TextAlignmentSelector: () => null,
  }),
);

vi.mock(
  "@/features/editor/components/bubble-menu/toolbar-action-button",
  () => ({
    ToolbarActionButton: ({
      item,
    }: {
      item: { name: string; command: () => void };
    }) => (
      <button type="button" onClick={item.command}>
        {item.name}
      </button>
    ),
  }),
);

vi.mock(
  "@/features/editor/components/bubble-menu/can-create-synced-block",
  () => ({
    canCreateSyncedBlock: () => true,
  }),
);

vi.mock("@/features/editor/components/bubble-menu/toolbar-items", () => ({
  useInlineTextToolbarItems: () => [],
}));

vi.mock("@/features/ai/components/ai-selection-action", () => ({
  AiSelectionActionButton: (props: unknown) => {
    aiSelectionActionMock(props);
    return <div data-testid="ai-selection-action" />;
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const run = vi.fn();
const chain = {
  focus: vi.fn(() => chain),
  toggleTransclusionSource: vi.fn(() => chain),
  run,
};
const editor = { chain: () => chain } as unknown as Editor;

describe("FixedToolbar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    aiSelectionActionMock.mockReset();
    editorStateMock.mockReset();
    run.mockReset();
    chain.focus.mockClear();
    chain.toggleTransclusionSource.mockClear();
  });

  it("renders the AI selection action in the toolbar", () => {
    editorStateMock.mockReturnValue({
      hasTextSelection: true,
      selectedText: "Selected text",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <FixedToolbar
          editor={editor}
          pageId="page-id"
          spaceId="space-id"
        />,
      );
    });

    expect(container.querySelector('[data-testid="ai-selection-action"]')).not
      .toBeNull();
    expect(aiSelectionActionMock).toHaveBeenCalledWith({
      editor,
      pageId: "page-id",
      spaceId: "space-id",
      disabled: false,
    });
  });

  it("disables the AI selection action without selected text", () => {
    editorStateMock.mockReturnValue({
      hasTextSelection: false,
      selectedText: "",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <FixedToolbar
          editor={editor}
          pageId="page-id"
          spaceId="space-id"
        />,
      );
    });

    expect(aiSelectionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true }),
    );
  });

  it("offers synced block creation when the selected range can be wrapped", () => {
    editorStateMock.mockReturnValue({
      canCreateSyncedBlock: true,
      hasTextSelection: true,
      selectedText: "Selected text",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<FixedToolbar editor={editor} />);
    });

    const action = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create synced block",
    );
    expect(action).toBeDefined();

    act(() => action?.click());
    expect(chain.focus).toHaveBeenCalledTimes(1);
    expect(chain.toggleTransclusionSource).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
