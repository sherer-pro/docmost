// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "./layout";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { stepUpMock, shellMock, state } = vi.hoisted(() => ({
  stepUpMock: vi.fn(),
  shellMock: vi.fn(),
  state: {
    spaceSlug: undefined as string | undefined,
    currentUser: {} as any,
    spaces: [] as any[],
    spaceContext: undefined as any,
  },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ spaceSlug: state.spaceSlug }),
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("@/features/user/user-provider.tsx", () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/features/space/queries/space-query.ts", () => ({
  useGetSpacesQuery: () => ({
    data: { items: state.spaces },
    isLoading: false,
  }),
  useSpacePolicyContextQuery: () => ({
    data: state.spaceContext,
    isLoading: false,
  }),
}));

vi.mock("jotai", () => ({
  useAtomValue: () => state.currentUser,
}));

vi.mock("@/features/user/atoms/current-user-atom.ts", () => ({
  currentUserAtom: "currentUserAtom",
}));

vi.mock("@/features/security/components/authentication-step-up.tsx", () => ({
  AuthenticationStepUp: (props: any) => {
    stepUpMock(props);
    return <div data-testid="step-up" />;
  },
}));

vi.mock("@/components/layouts/global/global-app-shell.tsx", () => ({
  default: (props: any) => {
    shellMock(props);
    return <div data-testid="shell">{props.children}</div>;
  },
}));

vi.mock("@/features/telemetry/components/posthog-user.tsx", () => ({
  PosthogUser: () => null,
}));

vi.mock("@/features/search/components/search-spotlight.tsx", () => ({
  SearchSpotlight: () => null,
}));

vi.mock("@/lib/config.ts", () => ({
  isCloud: () => false,
}));

vi.mock("@mantine/core", () => ({
  Center: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Loader: () => <div />,
}));

describe("authenticated assurance layout", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    stepUpMock.mockReset();
    shellMock.mockReset();
    state.spaceSlug = undefined;
    state.spaces = [];
    state.spaceContext = undefined;
    state.currentUser = {
      authenticationAssurance: {
        ssoVerified: false,
        mfaVerified: false,
        workspaceMissingRequirements: ["sso"],
      },
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows step-up for workspace routes when workspace assurance is missing", () => {
    act(() => root.render(<Layout />));

    expect(stepUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ requirements: ["sso"] }),
    );
    expect(shellMock).not.toHaveBeenCalled();
  });

  it("renders a permitted target space in restricted workspace mode", () => {
    state.spaceSlug = "open-space";
    state.spaces = [
      {
        id: "space-1",
        slug: "open-space",
        policy: {
          effective: {
            enforceSso: false,
            enforceMfa: false,
            disablePublicSharing: false,
          },
        },
      },
    ];
    state.spaceContext = state.spaces[0];

    act(() => root.render(<Layout />));

    expect(stepUpMock).not.toHaveBeenCalled();
    expect(shellMock).toHaveBeenCalledWith(
      expect.objectContaining({ restricted: true }),
    );
    expect(container.querySelector('[data-testid="outlet"]')).not.toBeNull();
  });

  it("uses bootstrap policy context when the target is outside the first catalog page", () => {
    state.spaceSlug = "space-101";
    state.spaceContext = {
      id: "space-101-id",
      slug: "space-101",
      policy: {
        effective: {
          enforceSso: false,
          enforceMfa: true,
          disablePublicSharing: false,
        },
      },
    };

    act(() => root.render(<Layout />));

    expect(stepUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requirements: ["mfa"],
        spaceSlug: "space-101",
      }),
    );
    expect(shellMock).not.toHaveBeenCalled();
  });
});
