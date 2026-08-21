// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NodeViewProps } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TemplateFieldView,
  TemplateManagedBlockView,
} from "./template-node-views";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    as: _as,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { as?: string }) => (
    <div {...props} />
  ),
  NodeViewContent: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-node-view-content {...props} />
  ),
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({
    children,
    gap,
    mb,
    size,
    fw,
    c,
    fs,
    variant,
    color,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
    void gap;
    void mb;
    void size;
    void fw;
    void c;
    void fs;
    void variant;
    void color;
    return <div {...props}>{children}</div>;
  };

  return { Badge: Wrapper, Group: Wrapper, Text: Wrapper };
});

vi.mock("@tabler/icons-react", () => ({
  IconForms: () => null,
  IconLock: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("template node view editability", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(props: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(props));
  }

  it("locks source content immediately when the editor switches to read mode", () => {
    const runtime = createEditorRuntime(true);
    render(
      <>
        <TemplateManagedBlockView
          {...nodeViewProps(runtime.editor, {
            templateBlockId: "block-1",
            locked: false,
          })}
        />
        <TemplateFieldView
          {...nodeViewProps(runtime.editor, {
            fieldId: "field-1",
            label: "Owner",
            placeholder: "Enter an owner",
          })}
        />
      </>,
    );

    expect(contentEditableValues(container!)).toEqual(["true", "true"]);

    runtime.setEditable(false);

    expect(contentEditableValues(container!)).toEqual(["false", "false"]);
  });

  it("keeps shared content locked while allowing fields on linked edit pages", () => {
    const runtime = createEditorRuntime(true);
    render(
      <>
        <TemplateManagedBlockView
          {...nodeViewProps(runtime.editor, {
            templateBlockId: "block-1",
            locked: true,
          })}
        />
        <TemplateFieldView
          {...nodeViewProps(runtime.editor, {
            fieldId: "field-1",
            label: null,
            placeholder: null,
          })}
        />
      </>,
    );

    expect(contentEditableValues(container!)).toEqual(["false", "true"]);
    expect(container?.textContent).toContain("Managed by template");
    expect(container?.textContent).toContain("Editable field");

    runtime.setEditable(false);

    expect(contentEditableValues(container!)).toEqual(["false", "false"]);
  });
});

function createEditorRuntime(initialEditable: boolean) {
  const updateHandlers = new Set<() => void>();
  const editor = {
    isEditable: initialEditable,
    on: vi.fn((event: string, callback: () => void) => {
      if (event === "update") updateHandlers.add(callback);
    }),
    off: vi.fn((event: string, callback: () => void) => {
      if (event === "update") updateHandlers.delete(callback);
    }),
  };

  return {
    editor,
    setEditable(value: boolean) {
      act(() => {
        editor.isEditable = value;
        updateHandlers.forEach((handler) => handler());
      });
    },
  };
}

function nodeViewProps(
  editor: ReturnType<typeof createEditorRuntime>["editor"],
  attrs: Record<string, unknown>,
) {
  return {
    editor,
    node: { attrs, textContent: "" },
  } as unknown as NodeViewProps;
}

function contentEditableValues(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-node-view-content]"),
  ).map((element) => element.getAttribute("contenteditable"));
}
