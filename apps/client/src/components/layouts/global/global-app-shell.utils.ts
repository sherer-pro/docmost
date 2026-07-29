export function getShellVisibilityState({
  isMobileViewport,
  mobileOpened,
  desktopOpened,
  hideSidebar,
  shouldShowAside,
  isAsideOpen,
}: {
  isMobileViewport: boolean;
  mobileOpened: boolean;
  desktopOpened: boolean;
  hideSidebar: boolean;
  shouldShowAside: boolean;
  isAsideOpen: boolean;
}) {
  return {
    isNavbarHidden:
      !hideSidebar && (isMobileViewport ? !mobileOpened : !desktopOpened),
    isAsideHidden: shouldShowAside && !isAsideOpen,
  };
}

export type AsidePresentationMode = "docked" | "overlay" | "fullscreen";

export function getAsidePresentationMode({
  viewportWidth,
  sidebarWidth,
  asideWidth,
  isSidebarVisible,
}: {
  viewportWidth: number;
  sidebarWidth: number;
  asideWidth: number;
  isSidebarVisible: boolean;
}): AsidePresentationMode {
  if (viewportWidth <= 768) {
    return "fullscreen";
  }

  const availableDocumentWidth =
    viewportWidth - (isSidebarVisible ? sidebarWidth : 0) - asideWidth;

  return availableDocumentWidth >= 720 ? "docked" : "overlay";
}
