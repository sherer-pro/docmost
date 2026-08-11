// @vitest-environment jsdom

import React, { act, forwardRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpaceLabelsSettings from "./space-labels-settings";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LABEL_ID = "00000000-0000-4000-8000-000000000001";

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Button = ({
    children,
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button {...props}>{children}</button>
  );
  const TextInput = ({
    label,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
    <label>
      {label}
      <input aria-label={label} {...props} />
    </label>
  );

  return {
    Button,
    Group: Wrapper,
    Paper: Wrapper,
    Skeleton: Wrapper,
    Stack: Wrapper,
    Text: Wrapper,
    TextInput,
  };
});

vi.mock("@mantine/modals", () => ({
  modals: { openConfirmModal: vi.fn() },
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: {
      pages: [
        {
          items: [{ id: LABEL_ID, name: "Release", pageCount: 1 }],
          meta: {},
        },
      ],
    },
    isLoading: false,
    hasNextPage: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/features/label/services/label-service", () => ({
  deleteLabel: vi.fn(),
  getLabelRegistry: vi.fn(),
  renameLabel: vi.fn(),
}));

vi.mock("@/components/ui/accessible-action-icon", () => ({
  AccessibleActionIcon: forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      label: string;
      loading?: boolean;
    }
  >(({ children, label, loading: _loading, ...props }, ref) => (
    <button ref={ref} aria-label={label} {...props}>
      {children}
    </button>
  )),
}));

describe("SpaceLabelsSettings", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("returns focus to the rename action after Escape", () => {
    const onEscape = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <div onKeyDown={onEscape}>
          <SpaceLabelsSettings spaceId="space-id" />
        </div>,
      );
    });

    const renameButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Rename Release"]',
    );
    expect(renameButton).not.toBeNull();

    act(() => renameButton?.click());
    const nameInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Name"]',
    );
    expect(document.activeElement).toBe(nameInput);
    expect(nameInput?.getAttribute("data-mantine-stop-propagation")).toBe(
      "true",
    );

    act(() => {
      nameInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Rename Release"]'),
    );
    expect(onEscape).not.toHaveBeenCalled();
  });
});
