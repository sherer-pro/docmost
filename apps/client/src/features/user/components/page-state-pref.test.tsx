// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { PageStateSegmentedControl } from "./page-state-pref";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_ID = "00000000-0000-4000-8000-000000000001";

const { updateUserMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn(),
}));

vi.mock("@/features/user/services/user-service.ts", () => ({
  updateUser: updateUserMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("@mantine/core", () => ({
  VisuallyHidden: ({ children }: { children: React.ReactNode }) => (
    <span data-visually-hidden="true">{children}</span>
  ),
  SegmentedControl: ({
    data,
    disabled,
    onChange,
    value,
  }: {
    data: Array<{ label: React.ReactNode; value: string }>;
    disabled?: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <div data-testid="segmented-control" data-value={value}>
      {data.map((item) => (
        <button
          disabled={disabled}
          key={item.value}
          onClick={() => onChange(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@tabler/icons-react", () => ({
  IconBook: () => <span data-testid="read-icon" aria-hidden="true" />,
  IconPencil: () => <span data-testid="edit-icon" aria-hidden="true" />,
}));

function createCurrentUser(
  pageEditModeByPageId?: Record<string, PageEditMode>,
): any {
  return {
    user: {
      id: "user-1",
      name: "User",
      email: "user@example.com",
      settings: {
        preferences: {
          fullPageWidth: false,
          pageEditModeByPageId,
          pushEnabled: false,
          emailEnabled: true,
          pushFrequency: "immediate",
          emailFrequency: "immediate",
        },
      },
    },
    workspace: { id: "ws-1" },
  };
}

function renderControl(
  pageEditModeByPageId?: Record<string, PageEditMode>,
  compact = false,
) {
  const store = createStore();
  store.set(currentUserAtom, createCurrentUser(pageEditModeByPageId));

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Provider store={store}>
        <PageStateSegmentedControl pageId={PAGE_ID} compact={compact} />
      </Provider>,
    );
  });

  return { container, root, store };
}

async function clickButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );

  if (!button) {
    throw new Error(`Button ${text} not found`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("PageStateSegmentedControl", () => {
  let mountedRoot: Root | null = null;
  let mountedContainer: HTMLElement | null = null;

  afterEach(() => {
    updateUserMock.mockReset();

    if (mountedRoot && mountedContainer) {
      act(() => {
        mountedRoot?.unmount();
      });
      mountedContainer.remove();
    }

    mountedRoot = null;
    mountedContainer = null;
  });

  it("sends a page-scoped edit mode update", async () => {
    const updatedUser = createCurrentUser({
      [PAGE_ID]: PageEditMode.Edit,
    }).user;
    updateUserMock.mockResolvedValue(updatedUser);

    const { container, root, store } = renderControl();
    mountedRoot = root;
    mountedContainer = container;

    await clickButton(container, "Edit");

    expect(updateUserMock).toHaveBeenCalledWith({
      pageEditModeByPageId: {
        [PAGE_ID]: PageEditMode.Edit,
      },
    });
    expect(
      store.get(currentUserAtom)?.user.settings.preferences
        .pageEditModeByPageId,
    ).toEqual({
      [PAGE_ID]: PageEditMode.Edit,
    });
  });

  it("rolls optimistic mode state back when saving fails", async () => {
    updateUserMock.mockRejectedValue(new Error("failed"));

    const { container, root, store } = renderControl({
      [PAGE_ID]: PageEditMode.Read,
    });
    mountedRoot = root;
    mountedContainer = container;

    await clickButton(container, "Edit");

    expect(
      store.get(currentUserAtom)?.user.settings.preferences
        .pageEditModeByPageId,
    ).toEqual({
      [PAGE_ID]: PageEditMode.Read,
    });
  });

  it("renders compact icon segments with accessible labels", () => {
    const { container, root } = renderControl(undefined, true);
    mountedRoot = root;
    mountedContainer = container;

    expect(container.querySelector('[data-testid="edit-icon"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="read-icon"]')).not.toBeNull();
    expect(container.textContent).toContain("Edit");
    expect(container.textContent).toContain("Read");
  });
});
