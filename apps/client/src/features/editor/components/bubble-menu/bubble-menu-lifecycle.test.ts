// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { BubbleMenuView } from "@tiptap/extension-bubble-menu";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createBubbleMenuView() {
  const parent = document.createElement("div");
  const viewDom = document.createElement("div");
  const element = document.createElement("div");
  parent.appendChild(viewDom);
  document.body.appendChild(parent);

  const state = {
    selection: {
      from: 1,
      to: 2,
      empty: false,
      ranges: [{ $from: { pos: 1 }, $to: { pos: 2 } }],
      eq: () => true,
    },
    doc: {
      textBetween: () => "selection",
      eq: () => true,
    },
  } as unknown as EditorState;
  const view = {
    state,
    dom: viewDom,
    composing: false,
    hasFocus: () => true,
  } as unknown as EditorView;
  let viewAccessCount = 0;
  const editor = {
    state,
    isDestroyed: false,
    isEditable: true,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
  Object.defineProperty(editor, "view", {
    configurable: true,
    get: () => {
      viewAccessCount += 1;
      return view;
    },
  });
  const getReferencedVirtualElement = vi.fn(() => ({
    getBoundingClientRect: () => new DOMRect(0, 0, 10, 10),
  }));
  const bubbleMenuView = new BubbleMenuView({
    editor,
    element,
    view,
    updateDelay: 25,
    resizeDelay: 25,
    shouldShow: () => false,
    getReferencedVirtualElement,
    pluginKey: "bubbleMenuLifecycleTest",
  });

  return {
    bubbleMenuView,
    editor,
    getReferencedVirtualElement,
    parent,
    view,
    getViewAccessCount: () => viewAccessCount,
  };
}

describe("patched BubbleMenu lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("cancels delayed view access when the editor is destroyed", () => {
    const harness = createBubbleMenuView();
    const oldState = {
      ...harness.view.state,
      selection: {
        ...harness.view.state.selection,
        eq: () => false,
      },
    } as unknown as EditorState;

    harness.bubbleMenuView.show();
    harness.bubbleMenuView.resizeHandler();
    harness.bubbleMenuView.focusHandler();
    harness.bubbleMenuView.handleDebouncedUpdate(harness.view, oldState);

    const accessesBeforeDestroy = harness.getViewAccessCount();
    Object.assign(harness.editor, { isDestroyed: true });
    harness.bubbleMenuView.destroy();
    harness.parent.remove();
    vi.runAllTimers();

    expect(harness.getViewAccessCount()).toBe(accessesBeforeDestroy);
    expect(harness.getReferencedVirtualElement).not.toHaveBeenCalled();
  });

  it("ignores explicit position updates after destroy", () => {
    const harness = createBubbleMenuView();

    harness.bubbleMenuView.show();
    harness.bubbleMenuView.destroy();
    harness.bubbleMenuView.updatePosition();

    expect(harness.getReferencedVirtualElement).not.toHaveBeenCalled();
  });
});
