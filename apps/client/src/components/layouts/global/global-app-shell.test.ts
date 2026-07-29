import { describe, expect, it } from "vitest";
import {
  getAsidePresentationMode,
  getShellVisibilityState,
} from "@/components/layouts/global/global-app-shell.utils";

describe("getShellVisibilityState", () => {
  it("hides the mobile sidebar from accessibility state when collapsed", () => {
    expect(
      getShellVisibilityState({
        isMobileViewport: true,
        mobileOpened: false,
        desktopOpened: true,
        hideSidebar: false,
        shouldShowAside: false,
        isAsideOpen: false,
      }).isNavbarHidden,
    ).toBe(true);
  });

  it("uses desktop sidebar state on desktop viewports", () => {
    expect(
      getShellVisibilityState({
        isMobileViewport: false,
        mobileOpened: false,
        desktopOpened: true,
        hideSidebar: false,
        shouldShowAside: false,
        isAsideOpen: false,
      }).isNavbarHidden,
    ).toBe(false);
  });

  it("hides the context aside when a page route supports aside but it is closed", () => {
    expect(
      getShellVisibilityState({
        isMobileViewport: false,
        mobileOpened: true,
        desktopOpened: true,
        hideSidebar: false,
        shouldShowAside: true,
        isAsideOpen: false,
      }).isAsideHidden,
    ).toBe(true);
  });
});

describe("getAsidePresentationMode", () => {
  it("uses a fullscreen drawer through the mobile breakpoint", () => {
    expect(
      getAsidePresentationMode({
        viewportWidth: 768,
        sidebarWidth: 300,
        asideWidth: 400,
        isSidebarVisible: true,
      }),
    ).toBe("fullscreen");
  });

  it("overlays the aside when docking would leave too little editor space", () => {
    expect(
      getAsidePresentationMode({
        viewportWidth: 1200,
        sidebarWidth: 300,
        asideWidth: 400,
        isSidebarVisible: true,
      }),
    ).toBe("overlay");
  });

  it("docks the aside when the editor keeps its minimum width", () => {
    expect(
      getAsidePresentationMode({
        viewportWidth: 1440,
        sidebarWidth: 300,
        asideWidth: 400,
        isSidebarVisible: true,
      }),
    ).toBe("docked");
  });
});
