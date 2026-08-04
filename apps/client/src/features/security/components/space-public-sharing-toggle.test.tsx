// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SpaceSecurityPolicies from "./space-public-sharing-toggle";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { mutateAsyncMock, state } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  state: {
    role: "member",
  },
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Badge: Wrapper,
    Group: Wrapper,
    Stack: Wrapper,
    Text: Wrapper,
    SegmentedControl: ({
      data,
      onChange,
      "aria-label": ariaLabel,
    }: any) => (
      <div aria-label={ariaLabel}>
        {data.map((option: any) => (
          <button
            key={option.value}
            data-policy={ariaLabel}
            data-state={option.value}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
  };
});

vi.mock("@mantine/modals", () => ({
  modals: { openConfirmModal: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string, options?: { value?: string }) =>
      options?.value ? value.replace("{{value}}", options.value) : value,
  }),
}));

vi.mock("@/features/user/atoms/current-user-atom.ts", () => ({
  userAtom: "userAtom",
  workspaceAtom: "workspaceAtom",
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: string) =>
    atom === "userAtom"
      ? { role: state.role }
      : {
          enforceMfa: true,
          enforceSso: true,
          settings: { sharing: { disabled: true } },
        },
}));

vi.mock("@/features/space/queries/space-query.ts", () => ({
  useUpdateSpaceMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/components/ui/responsive-settings-row.tsx", () => ({
  ResponsiveSettingsContent: ({ children }: any) => <div>{children}</div>,
  ResponsiveSettingsControl: ({ children }: any) => <div>{children}</div>,
  ResponsiveSettingsRow: ({ children }: any) => <div>{children}</div>,
}));

const space = {
  id: "space-1",
  settings: {},
  policy: {
    overrides: {
      enforceMfa: null,
      enforceSso: null,
      disablePublicSharing: null,
    },
    effective: {
      enforceMfa: true,
      enforceSso: true,
      disablePublicSharing: true,
    },
  },
} as any;

describe("SpaceSecurityPolicies", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mutateAsyncMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders inherit, enabled, and disabled for all three policies", () => {
    state.role = "admin";
    act(() => root.render(<SpaceSecurityPolicies space={space} />));

    expect(container.querySelectorAll('[data-state="inherit"]')).toHaveLength(
      3,
    );
    expect(container.querySelectorAll('[data-state="enabled"]')).toHaveLength(
      3,
    );
    expect(
      container.querySelectorAll('[data-state="disabled"]'),
    ).toHaveLength(3);
  });

  it("allows a space administrator to select only enabled overrides", () => {
    state.role = "member";
    act(() => root.render(<SpaceSecurityPolicies space={space} />));

    expect(
      container.querySelectorAll('[data-state="inherit"]:disabled'),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-state="disabled"]:disabled'),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-state="enabled"]:disabled'),
    ).toHaveLength(0);
  });

  it("allows workspace administrators to select every override state", () => {
    state.role = "admin";
    act(() => root.render(<SpaceSecurityPolicies space={space} />));

    expect(
      container.querySelectorAll('[data-state="disabled"]:disabled'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-state="inherit"]:disabled'),
    ).toHaveLength(0);
  });
});
