// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkspaceAdminRoute from "./workspace-admin-route";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { useCurrentUserMock } = vi.hoisted(() => ({
  useCurrentUserMock: vi.fn(),
}));

vi.mock("@/features/user/hooks/use-current-user.ts", () => ({
  default: useCurrentUserMock,
}));

function CurrentPath() {
  const location = useLocation();
  return <div data-path={location.pathname}>{location.pathname}</div>;
}

describe("WorkspaceAdminRoute", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    useCurrentUserMock.mockReset();
  });

  function renderRoute() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <MemoryRouter initialEntries={["/settings/workspace"]}>
          <Routes>
            <Route element={<WorkspaceAdminRoute />}>
              <Route
                path="/settings/workspace"
                element={<CurrentPath />}
              />
            </Route>
            <Route
              path="/settings/account/profile"
              element={<CurrentPath />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  it.each(["owner", "admin"])(
    "allows workspace role %s",
    (role) => {
      useCurrentUserMock.mockReturnValue({
        data: { user: { role } },
        isLoading: false,
      });

      renderRoute();

      expect(
        container?.querySelector("[data-path]")?.getAttribute("data-path"),
      ).toBe("/settings/workspace");
    },
  );

  it("redirects workspace members to account settings", () => {
    useCurrentUserMock.mockReturnValue({
      data: { user: { role: "member" } },
      isLoading: false,
    });

    renderRoute();

    expect(
      container?.querySelector("[data-path]")?.getAttribute("data-path"),
    ).toBe("/settings/account/profile");
  });
});
