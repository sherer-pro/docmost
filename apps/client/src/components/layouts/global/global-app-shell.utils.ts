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
