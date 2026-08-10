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
  const { isAsideOpen } = asideState;
  const [asideWidth, setAsideWidth] = useAtom(asideWidthAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isResizing, setIsResizing] = useState(false);
  const [isAsideResizing, setIsAsideResizing] = useState(false);
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
    setIsAsideResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent) => {
      if (isAsideResizing) {
        setAsideWidth(
          Math.min(
            520,
            Math.max(360, window.innerWidth - mouseMoveEvent.clientX),
          ),
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
    [isAsideResizing, isResizing, setAsideWidth],
  );

  const startAsideResizing = React.useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    setIsAsideResizing(true);
  }, []);

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
  const asideMode = getAsidePresentationMode({
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
            width: asideWidth,
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

        {shouldShowAside && isDockedAside && (
          <AppShell.Aside
            id="docmost-context-aside"
            className={classes.aside}
            p={0}
            withBorder={false}
            ref={asideRef}
            aria-hidden={isAsideHidden || undefined}
          >
            <div
              className={classes.asideResizeHandle}
              onMouseDown={startAsideResizing}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("ai.resizePanel")}
              aria-valuemin={360}
              aria-valuemax={520}
              aria-valuenow={asideWidth}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  setAsideWidth(Math.min(520, asideWidth + 10));
                }
                if (event.key === "ArrowRight") {
                  setAsideWidth(Math.max(360, asideWidth - 10));
                }
              }}
            />
            <Aside />
          </AppShell.Aside>
        )}

        {shouldShowAside && isOverlayAside && (
          <aside
            id="docmost-context-aside"
            className={classes.overlayAside}
            aria-hidden={!isAsideOpen || undefined}
            style={{
              width: "clamp(360px, 42vw, 480px)",
              transform: isAsideOpen ? "translateX(0)" : "translateX(100%)",
            }}
            ref={asideRef}
          >
            <Aside />
          </aside>
        )}

        {shouldShowAside && asideMode === "fullscreen" && (
          <Drawer
            opened={isAsideOpen}
            onClose={() => setAsideState({ ...asideState, isAsideOpen: false })}
            position="right"
            size="100%"
            withCloseButton={false}
            padding={0}
            title={assistantIdentity.name}
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
                height: "100dvh",
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
