// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpaceSettingsModal from "./settings-modal";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SPACE_ID = "00000000-0000-4000-8000-000000000001";

const {
  aiSpaceSettingsMock,
  hasFullSpaceAccessMock,
  useSpaceQueryMock,
} = vi.hoisted(() => ({
  aiSpaceSettingsMock: vi.fn(),
  hasFullSpaceAccessMock: vi.fn(),
  useSpaceQueryMock: vi.fn(),
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );

  const Modal = {
    Root: Wrapper,
    Overlay: Wrapper,
    Content: Wrapper,
    Header: Wrapper,
    Title: Wrapper,
    CloseButton: Wrapper,
    Body: Wrapper,
  };
  const Tabs = Object.assign(Wrapper, {
    List: Wrapper,
    Tab: Wrapper,
    Panel: Wrapper,
  });

  return {
    Modal,
    Portal: Wrapper,
    Tabs,
    ScrollArea: Wrapper,
    Text: Wrapper,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("jotai", () => ({
  useAtomValue: () => ({ role: "admin" }),
}));

vi.mock("@/features/user/atoms/current-user-atom.ts", () => ({
  userAtom: Symbol("userAtom"),
}));

vi.mock("@/features/space/queries/space-query.ts", () => ({
  useSpaceQuery: useSpaceQueryMock,
}));

vi.mock("@/features/space/permissions/use-space-ability.ts", () => ({
  useSpaceAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock("@/features/space/permissions/export-access.ts", () => ({
  hasFullSpaceAccess: hasFullSpaceAccessMock,
}));

vi.mock("@/features/space/components/space-members.tsx", () => ({
  default: () => null,
}));

vi.mock("@/features/space/components/add-space-members-modal.tsx", () => ({
  default: () => null,
}));

vi.mock("@/features/space/components/space-details.tsx", () => ({
  default: () => null,
}));

vi.mock("@/features/ai/components/ai-space-settings.tsx", () => ({
  AiSpaceSettings: (props: { spaceId: string }) => {
    aiSpaceSettingsMock(props);
    return <div data-testid="ai-space-settings" />;
  },
}));

describe("SpaceSettingsModal", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    aiSpaceSettingsMock.mockReset();
    hasFullSpaceAccessMock.mockReset();
    useSpaceQueryMock.mockReset();
  });

  it("passes the resolved space UUID to AI settings when opened by slug", () => {
    hasFullSpaceAccessMock.mockReturnValue(true);
    useSpaceQueryMock.mockReturnValue({
      data: {
        id: SPACE_ID,
        slug: "TS",
        name: "Test space",
        membership: {
          role: "admin",
          permissions: [],
        },
      },
      isLoading: false,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <SpaceSettingsModal
          spaceId="TS"
          opened
          onClose={() => undefined}
        />,
      );
    });

    expect(useSpaceQueryMock).toHaveBeenCalledWith("TS");
    expect(aiSpaceSettingsMock).toHaveBeenCalledWith({
      spaceId: SPACE_ID,
    });
  });

  it("does not render settings for non-admin space members", () => {
    hasFullSpaceAccessMock.mockReturnValue(false);
    useSpaceQueryMock.mockReturnValue({
      data: {
        id: SPACE_ID,
        slug: "TS",
        name: "Test space",
        membership: {
          role: "writer",
          permissions: [],
        },
      },
      isLoading: false,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <SpaceSettingsModal
          spaceId="TS"
          opened
          onClose={() => undefined}
        />,
      );
    });

    expect(container.innerHTML).toBe("");
    expect(aiSpaceSettingsMock).not.toHaveBeenCalled();
  });
});
