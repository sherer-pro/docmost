import { AppShell, Drawer } from "@mantine/core";
import { useMediaQuery, useViewportSize } from "@mantine/hooks";
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import SettingsSidebar from "@/components/settings/settings-sidebar.tsx";
import { useAtom } from "jotai";
import {
  asideStateAtom,
  asideWidthAtom,
  desktopSidebarAtom,
  mobileSidebarAtom,
  sidebarWidthAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { SpaceSidebar } from "@/features/space/components/sidebar/space-sidebar.tsx";
import { AppHeader } from "@/components/layouts/global/app-header.tsx";
import Aside from "@/components/layouts/global/aside.tsx";
import classes from "./app-shell.module.css";
import { PageFrame } from "@/components/ui/page-frame.tsx";
import {
  getAiFocusAsideLayout,
  getAsidePresentationMode,
  getShellVisibilityState,
} from "@/components/layouts/global/global-app-shell.utils.ts";
import { useSetAtom } from "jotai";
import { AiSocketBridge } from "@/features/ai/hooks/use-ai-socket.ts";
import { AiPanelPreferencesSync } from "@/features/ai/components/ai-panel-preferences-sync.tsx";
import { useTranslation } from "react-i18next";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useAiAssistantIdentity } from "@/features/ai/hooks/use-ai-assistant-identity.ts";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert.ts";
import { aiFocusModeAtom } from "@/features/ai/atoms/ai-atoms.ts";
import {
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  clampAiPanelWidth,
  getAiPanelWidthForKey,
} from "@/features/ai/utils/ai-policies.ts";

export default function GlobalAppShell({
  children,
  restricted = false,
}: {
  children: React.ReactNode;
  restricted?: boolean;
}) {
  const { t } = useTranslation();
  const assistantIdentity = useAiAssistantIdentity();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const setMobileOpened = useSetAtom(mobileSidebarAtom);
  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const [asideState] = useAtom(asideStateAtom);
  const setAsideState = useSetAtom(asideStateAtom);
  const [aiFocusMode, setAiFocusMode] = useAtom(aiFocusModeAtom);
  const { isAsideOpen } = asideState;
  const fullscreenAsideTitle =
    asideState.tab === "comments"
      ? t("Comments")
      : asideState.tab === "toc"
        ? t("Table of contents")
        : assistantIdentity.name;
  const [asideWidth, setAsideWidth] = useAtom(asideWidthAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isResizing, setIsResizing] = useState(false);
  const [isAsideResizing, setIsAsideResizing] = useState(false);
  const isAsideResizingRef = useRef(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const isMobileViewport = useMediaQuery("(max-width: 48em)");
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { width: viewportWidth } = useViewportSize();

  const startResizing = React.useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
    isAsideResizingRef.current = false;
    setIsAsideResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent) => {
      if (isAsideResizingRef.current) {
        setAsideWidth(
          clampAiPanelWidth(window.innerWidth - mouseMoveEvent.clientX),
        );
        return;
      }

      if (isResizing) {
        if (!sidebarRef.current) {
          return;
        }

        const newWidth =
          mouseMoveEvent.clientX -
          sidebarRef.current.getBoundingClientRect().left;
        if (newWidth < 220) {
          setSidebarWidth(220);
          return;
        }
        if (newWidth > 600) {
          setSidebarWidth(600);
          return;
        }
        setSidebarWidth(newWidth);
      }
    },
    [isResizing, setAsideWidth, setSidebarWidth],
  );

  const startAsideResizing = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      isAsideResizingRef.current = true;
      setIsAsideResizing(true);
    },
    [],
  );

  const startAsideMouseResizing = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      isAsideResizingRef.current = true;
      setIsAsideResizing(true);
    },
    [],
  );

  const resizeAside = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }
      setAsideWidth(clampAiPanelWidth(window.innerWidth - event.clientX));
    },
    [setAsideWidth],
  );

  const stopAsideResizing = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      isAsideResizingRef.current = false;
      setIsAsideResizing(false);
    },
    [],
  );

  useEffect(() => {
    if (!isAsideResizing) {
      return;
    }
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isAsideResizing]);

  useEffect(() => {
    //https://codesandbox.io/p/sandbox/kz9de
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  const location = useLocation();

  useEffect(() => {
    if (isMobileViewport) {
      setMobileOpened(false);
    }
  }, [isMobileViewport, location.pathname, setMobileOpened]);

  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isWideSettingsRoute =
    location.pathname.startsWith("/settings/ai") ||
    location.pathname.startsWith("/settings/keys");
  const isSpaceRoute = location.pathname.startsWith("/s/");
  const isHomeRoute = location.pathname.startsWith("/home");
  const isSpacesRoute = location.pathname === "/spaces";
  const isPageRoute = location.pathname.includes("/p/");
  const isDatabaseRoute = location.pathname.includes("/db/");
  const shouldShowAside = !restricted && (isPageRoute || isDatabaseRoute);
  const hideSidebar = isHomeRoute || isSpacesRoute;
  const isDesktopSidebarVisible =
    !isMobileViewport && desktopOpened && !hideSidebar;
  const isAiFocusMode = aiFocusMode && asideState.tab === "ai";
  const focusLayout = getAiFocusAsideLayout({
    viewportWidth,
    sidebarWidth: isSpaceRoute ? sidebarWidth : 300,
    isSidebarVisible: isDesktopSidebarVisible,
  });
  const renderedAsideWidth = isAiFocusMode ? focusLayout.width : asideWidth;
  const asideMode = isAiFocusMode
    ? focusLayout.mode
    : getAsidePresentationMode({
        viewportWidth,
        sidebarWidth: isSpaceRoute ? sidebarWidth : 300,
        asideWidth,
        isSidebarVisible: isDesktopSidebarVisible,
      });
  const isDockedAside = asideMode === "docked";
  const isOverlayAside = asideMode === "overlay";
  useModalBackgroundInert(
    shouldShowAside && asideMode === "fullscreen" && isAsideOpen,
  );

  useEffect(() => {
    if (!isAsideOpen || asideState.tab !== "ai") {
      setAiFocusMode(false);
    }
  }, [asideState.tab, isAsideOpen, setAiFocusMode]);

  useEffect(() => {
    if (!isAiFocusMode || asideMode !== "docked") {
      return;
    }

    const exitFocusMode = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setAiFocusMode(false);
      }
    };
    window.addEventListener("keydown", exitFocusMode);
    return () => window.removeEventListener("keydown", exitFocusMode);
  }, [asideMode, isAiFocusMode, setAiFocusMode]);
  const { isNavbarHidden, isAsideHidden } = getShellVisibilityState({
    isMobileViewport: Boolean(isMobileViewport),
    mobileOpened,
    desktopOpened,
    hideSidebar,
    shouldShowAside,
    isAsideOpen,
  });

  useEffect(() => {
    if (!sidebarRef.current) {
      return;
    }

    if (isNavbarHidden) {
      sidebarRef.current.setAttribute("inert", "");
    } else {
      sidebarRef.current.removeAttribute("inert");
    }
  }, [isNavbarHidden]);

  useEffect(() => {
    if (!asideRef.current) {
      return;
    }

    if (isAsideHidden) {
      asideRef.current.setAttribute("inert", "");
    } else {
      asideRef.current.removeAttribute("inert");
    }
  }, [isAsideHidden]);

  return (
    <DndProvider backend={HTML5Backend}>
      <a href="#docmost-main-content" className="skip-link">
        {t("Skip to main content")}
      </a>
      <AppShell
        header={{ height: 45 }}
        navbar={
          !hideSidebar && {
            width: isSpaceRoute ? sidebarWidth : 300,
            breakpoint: "sm",
            collapsed: {
              mobile: !mobileOpened,
              desktop: !desktopOpened,
            },
          }
        }
        aside={
          shouldShowAside &&
          isDockedAside && {
            width: renderedAsideWidth,
            breakpoint: "sm",
            collapsed: { mobile: !isAsideOpen, desktop: !isAsideOpen },
          }
        }
        padding="md"
      >
        {!restricted && <AiSocketBridge />}
        {!restricted && <AiPanelPreferencesSync />}
        <AppShell.Header px="md" className={classes.header}>
          <AppHeader restricted={restricted} />
        </AppShell.Header>
        {!hideSidebar && (
          <AppShell.Navbar
            id="docmost-primary-sidebar"
            className={classes.navbar}
            withBorder={false}
            ref={sidebarRef}
            aria-hidden={isNavbarHidden || undefined}
          >
            <div className={classes.resizeHandle} onMouseDown={startResizing} />
            {isSpaceRoute && <SpaceSidebar />}
            {isSettingsRoute && <SettingsSidebar />}
          </AppShell.Navbar>
        )}
        {!hideSidebar && isMobileViewport && mobileOpened && (
          <button
            type="button"
            className={classes.mobileSidebarBackdrop}
            aria-label={t("Close")}
            onClick={() => setMobileOpened(false)}
          />
        )}
        <AppShell.Main
          id="docmost-main-content"
          className={classes.main}
          tabIndex={-1}
        >
          {isSettingsRoute ? (
            <PageFrame size={isWideSettingsRoute ? "wide" : "settings"}>
              {children}
            </PageFrame>
          ) : (
            children
          )}
        </AppShell.Main>

        {shouldShowAside && asideMode !== "fullscreen" && (
          <AppShell.Aside
            id="docmost-context-aside"
            className={isOverlayAside ? classes.overlayAside : classes.aside}
            p={0}
            withBorder={false}
            ref={asideRef}
            aria-hidden={isAsideHidden || undefined}
            data-presentation-mode={asideMode}
            data-resizing={isAsideResizing || undefined}
            style={
              isOverlayAside
                ? {
                    width: `${asideWidth}px`,
                    transform: isAsideOpen
                      ? "translateX(0)"
                      : "translateX(100%)",
                  }
                : undefined
            }
          >
            {!isAiFocusMode && (
              <div
                className={classes.asideResizeHandle}
                onPointerDown={startAsideResizing}
                onPointerMove={resizeAside}
                onPointerUp={stopAsideResizing}
                onPointerCancel={stopAsideResizing}
                onMouseDown={startAsideMouseResizing}
                role="separator"
                aria-orientation="vertical"
                aria-label={t("ai.resizePanel")}
                aria-valuemin={AI_PANEL_MIN_WIDTH}
                aria-valuemax={AI_PANEL_MAX_WIDTH}
                aria-valuenow={asideWidth}
                tabIndex={0}
                onKeyDown={(event) => {
                  const nextWidth = getAiPanelWidthForKey(
                    asideWidth,
                    event.key,
                  );
                  if (nextWidth !== null) {
                    event.preventDefault();
                    setAsideWidth(nextWidth);
                  }
                }}
              />
            )}
            <Aside />
          </AppShell.Aside>
        )}

        {shouldShowAside && asideMode === "fullscreen" && (
          <Drawer
            opened={isAsideOpen}
            onClose={() => {
              if (isAiFocusMode) {
                setAiFocusMode(false);
                return;
              }
              setAsideState({ ...asideState, isAsideOpen: false });
            }}
            position="right"
            size="100%"
            withCloseButton={false}
            padding={0}
            title={fullscreenAsideTitle}
            keepMounted
            transitionProps={{ duration: reduceMotion ? 0 : 180 }}
            styles={{
              header: {
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                overflow: "hidden",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
              },
              body: {
                height: "100%",
                minHeight: 0,
                maxHeight: "100%",
                overflow: "hidden",
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
              },
            }}
          >
            <Aside />
          </Drawer>
        )}
      </AppShell>
    </DndProvider>
  );
}
