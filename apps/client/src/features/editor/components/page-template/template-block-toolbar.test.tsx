// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateBlockToolbar } from "./template-block-toolbar";

const mocks = vi.hoisted(() => ({
  state: {
    inManagedBlock: false,
    inField: false,
    fieldLabel: null as string | null,
    fieldPlaceholder: null as string | null,
  },
}));

vi.mock("@tiptap/react", () => ({
  useEditorState: () => mocks.state,
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({
    children,
    gap,
    justify,
    align,
    wrap,
    size,
    fw,
    c,
    maw,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
    void gap;
    void justify;
    void align;
    void wrap;
    void size;
    void fw;
    void c;
    void maw;
    return <div {...props}>{children}</div>;
  };
  const Button = ({
    children,
    leftSection,
    rightSection,
    size,
    variant,
    color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Record<string, unknown>) => {
    void size;
    void variant;
    void color;
    return (
      <button type="button" {...props}>
        {leftSection as React.ReactNode}
        {children}
        {rightSection as React.ReactNode}
      </button>
    );
  };
  const Paper = ({
    children,
    withBorder,
    radius,
    p,
    mb,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
    void withBorder;
    void radius;
    void p;
    void mb;
    return <div {...props}>{children}</div>;
  };
  const Modal = ({
    opened,
    title,
    children,
  }: {
    opened: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    opened ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;
  const TextInput = ({
    label,
    value,
    onChange,
    placeholder,
  }: {
    label: React.ReactNode;
    value: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    placeholder?: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={String(label)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </label>
  );
  const Menu = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  Menu.Target = Wrapper;
  Menu.Dropdown = Wrapper;
  Menu.Item = Button;

  return {
    Button,
    Group: Wrapper,
    Menu,
    Modal,
    Paper,
    Stack: Wrapper,
    Text: Wrapper,
    TextInput,
  };
});

vi.mock("@tabler/icons-react", () => ({
  IconForms: () => null,
  IconLock: () => null,
  IconPencil: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TemplateBlockToolbar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    mocks.state.inManagedBlock = false;
    mocks.state.inField = false;
    mocks.state.fieldLabel = null;
    mocks.state.fieldPlaceholder = null;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("explains the two content types and keeps conversions contextual", () => {
    const runtime = createChainRuntime();
    render(runtime.editor);

    expect(container?.textContent).toContain("Template content");
    expect(container?.textContent).toContain("Shared content");
    expect(container?.textContent).toContain("Editable field");
    expect(container?.textContent).toContain(
      "They are edited only in the template and appear read-only on linked pages.",
    );
    expect(container?.textContent).toContain(
      "People fill these on linked pages. Their values survive every publication.",
    );
    expect(container?.textContent).not.toContain("Make editable on each page");
    expect(container?.textContent).not.toContain("Make shared on every page");

    act(() => buttonContaining("Shared content").click());
    expect(runtime.insertTemplateManagedBlock).toHaveBeenCalledTimes(1);

    act(() => buttonContaining("Editable field").click());
    expect(container?.querySelector('[role="dialog"]')?.textContent).toContain(
      "Editable field",
    );
    act(() => buttonContaining("Save field").click());
    expect(runtime.insertTemplateField).toHaveBeenCalledWith({
      label: null,
      placeholder: null,
    });
  });

  it("converts selected shared content through the field dialog", () => {
    mocks.state.inManagedBlock = true;
    const runtime = createChainRuntime();
    render(runtime.editor);

    expect(container?.textContent).toContain("Make editable on each page");
    expect(container?.textContent).not.toContain("Make shared on every page");

    act(() => buttonContaining("Make editable on each page").click());
    act(() => buttonContaining("Save field").click());
    expect(runtime.convertTemplateManagedBlockToField).toHaveBeenCalledWith({
      label: null,
      placeholder: null,
    });
  });

  it("shows field settings and the reverse conversion only for a field", () => {
    mocks.state.inField = true;
    mocks.state.fieldLabel = "Owner";
    mocks.state.fieldPlaceholder = "Enter an owner";
    const runtime = createChainRuntime();
    render(runtime.editor);

    expect(container?.textContent).toContain("Field settings");
    expect(container?.textContent).toContain("Make shared on every page");
    expect(container?.textContent).not.toContain("Make editable on each page");

    act(() => buttonContaining("Make shared on every page").click());
    expect(runtime.convertTemplateFieldToManagedBlock).toHaveBeenCalledTimes(1);
  });

  function render(editor: ReturnType<typeof createChainRuntime>["editor"]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TemplateBlockToolbar editor={editor as never} />));
  }

  function buttonContaining(text: string) {
    const button = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent?.includes(text),
    );
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
  }
});

function createChainRuntime() {
  const runtime = {
    focus: vi.fn(),
    insertTemplateManagedBlock: vi.fn(),
    insertTemplateField: vi.fn(),
    convertTemplateManagedBlockToField: vi.fn(),
    convertTemplateFieldToManagedBlock: vi.fn(),
    updateAttributes: vi.fn(),
    run: vi.fn(() => true),
  };
  const chain = Object.fromEntries(
    Object.entries(runtime).map(([name, mock]) => [
      name,
      (...args: unknown[]) => {
        mock(...args);
        return chain;
      },
    ]),
  );

  return {
    ...runtime,
    editor: { chain: () => chain },
  };
}
