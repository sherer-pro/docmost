import { AppShell, Drawer } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
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
import { useTrialEndAction } from "@/ee/hooks/use-trial-end-action.tsx";
import { PageFrame } from "@/components/ui/page-frame.tsx";
import { getShellVisibilityState } from "@/components/layouts/global/global-app-shell.utils.ts";
import { useSetAtom } from "jotai";
import { AiSocketBridge } from "@/features/ai/hooks/use-ai-socket.ts";
import { AiPanelPreferencesSync } from "@/features/ai/components/ai-panel-preferences-sync.tsx";
import { useTranslation } from "react-i18next";

export default function GlobalAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  useTrialEndAction();
  const { t } = useTranslation();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
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
            600,
            Math.max(300, window.innerWidth - mouseMoveEvent.clientX),
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
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isSpaceRoute = location.pathname.startsWith("/s/");
  const isHomeRoute = location.pathname.startsWith("/home");
  const isSpacesRoute = location.pathname === "/spaces";
  const isPageRoute = location.pathname.includes("/p/");
  const isDatabaseRoute = location.pathname.includes("/db/");
  const shouldShowAside = isPageRoute || isDatabaseRoute;
  const hideSidebar = isHomeRoute || isSpacesRoute;
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
        !isMobileViewport && {
          width: asideWidth,
          breakpoint: "sm",
          collapsed: { mobile: !isAsideOpen, desktop: !isAsideOpen },
        }
      }
      padding="md"
    >
      <AiSocketBridge />
      <AiPanelPreferencesSync />
      <AppShell.Header px="md" className={classes.header}>
        <AppHeader />
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
      <AppShell.Main>
        {isSettingsRoute ? (
          <PageFrame size="settings">{children}</PageFrame>
        ) : (
          children
        )}
      </AppShell.Main>

      {shouldShowAside && !isMobileViewport && (
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
            aria-valuemin={300}
            aria-valuemax={600}
            aria-valuenow={asideWidth}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                setAsideWidth(Math.min(600, asideWidth + 10));
              }
              if (event.key === "ArrowRight") {
                setAsideWidth(Math.max(300, asideWidth - 10));
              }
            }}
          />
          <Aside />
        </AppShell.Aside>
      )}

      {shouldShowAside && Boolean(isMobileViewport) && (
        <Drawer
          opened={isAsideOpen}
          onClose={() => setAsideState({ ...asideState, isAsideOpen: false })}
          position="right"
          size="100%"
          withCloseButton={false}
          padding={0}
          title={null}
          aria-label={t("ai.title")}
          keepMounted
          styles={{
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
  );
}
