// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { createStore, Provider, useAtomValue } from "jotai";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { HeadingNumbering } from "@docmost/editor-ext";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { resolveHeadingNumberingEnabled } from "@/features/page/utils/heading-numbering";
import { HeadingNumberingMenuItems } from "./heading-numbering-menu-items";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_ID = "00000000-0000-4000-8000-000000000001";

const { updateUserMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn(),
}));

vi.mock("@/features/user/services/user-service", () => ({
  updateUser: updateUserMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("@mantine/modals", () => ({
  modals: { openConfirmModal: vi.fn() },
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("@mantine/core", () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Menu: {
    Item: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => <div onClick={onClick}>{children}</div>,
  },
  Switch: ({
    checked,
    disabled,
    label,
    "aria-label": ariaLabel,
    onChange,
  }: {
    checked: boolean;
    disabled?: boolean;
    label?: string;
    "aria-label"?: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
  }) => (
    <label>
      {label}
      <input
        aria-label={ariaLabel ?? label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        type="checkbox"
      />
    </label>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

function createCurrentUser(
  headingNumberingByPageId?: Record<string, boolean>,
) {
  return {
    user: {
      id: "user-1",
      settings: {
        preferences: {
          fullPageWidth: false,
          headingNumberingByPageId,
        },
      },
    },
    workspace: { id: "workspace-1" },
  } as any;
}

function TestMenu({ editor, canWrite }: { editor: Editor; canWrite: boolean }) {
  const currentUser = useAtomValue(currentUserAtom);
  const preferences = currentUser?.user.settings.preferences;

  return (
    <HeadingNumberingMenuItems
      pageId={PAGE_ID}
      checked={resolveHeadingNumberingEnabled({
        pageId: PAGE_ID,
        preferences,
        spaceSettings: { headingNumbering: { enabled: true } },
      })}
      editor={editor}
      canWrite={canWrite}
    />
  );
}

describe("HeadingNumberingMenuItems", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let editor: Editor | null = null;

  afterEach(() => {
    updateUserMock.mockReset();
    act(() => root?.unmount());
    editor?.destroy();
    container?.remove();
    root = null;
    container = null;
    editor = null;
  });

  function renderMenu(canWrite: boolean) {
    const store = createStore();
    store.set(currentUserAtom, createCurrentUser());
    editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: "<h1>Heading</h1>",
    });
    (editor.storage as { pageId?: string }).pageId = PAGE_ID;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Provider store={store}>
          <TestMenu editor={editor as Editor} canWrite={canWrite} />
        </Provider>,
      );
    });

    return { store };
  }

  it("saves a personal override for read-only viewers", async () => {
    const updatedUser = createCurrentUser({ [PAGE_ID]: false }).user;
    updateUserMock.mockResolvedValue(updatedUser);
    const { store } = renderMenu(false);
    const toggle = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Heading numbering"]',
    );

    await act(async () => {
      if (!toggle) {
        throw new Error("Heading numbering toggle is missing");
      }
      toggle.checked = false;
      Simulate.change(toggle);
      await Promise.resolve();
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      headingNumberingByPageId: { [PAGE_ID]: false },
    });
    expect(
      store.get(currentUserAtom)?.user.settings.preferences
        .headingNumberingByPageId,
    ).toEqual({ [PAGE_ID]: false });
  });

  it("keeps the previous preference when saving fails", async () => {
    updateUserMock.mockRejectedValue(new Error("failed"));
    const { store } = renderMenu(false);
    const toggle = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Heading numbering"]',
    );

    await act(async () => {
      if (!toggle) {
        throw new Error("Heading numbering toggle is missing");
      }
      toggle.checked = false;
      Simulate.change(toggle);
      await Promise.resolve();
    });

    expect(
      store.get(currentUserAtom)?.user.settings.preferences
        .headingNumberingByPageId,
    ).toBeUndefined();
  });

  it("shows manual cleanup only while an editable page has a match", () => {
    renderMenu(true);
    expect(container?.textContent).not.toContain(
      "Remove manual heading numbering",
    );

    act(() => {
      editor?.commands.setContent("<h1>1. Heading</h1>");
    });
    expect(container?.textContent).toContain("Remove manual heading numbering");

    act(() => {
      editor?.commands.setContent("<h1>Heading</h1>");
    });
    expect(container?.textContent).not.toContain(
      "Remove manual heading numbering",
    );
  });
});
