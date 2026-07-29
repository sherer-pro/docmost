import { Badge, Group, Text, Tooltip } from "@mantine/core";
import classes from "./app-header.module.css";
import React from "react";
import TopMenu from "@/components/layouts/global/top-menu.tsx";
import { Link } from "react-router-dom";
import APP_ROUTE from "@/lib/app-route.ts";
import { useAtom } from "jotai";
import {
  desktopSidebarAtom,
  mobileSidebarAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import SidebarToggle from "@/components/ui/sidebar-toggle-button.tsx";
import { useTranslation } from "react-i18next";
import useTrial from "@/ee/hooks/use-trial.tsx";
import { isCloud } from "@/lib/config.ts";
import {
  SearchControl,
  SearchMobileControl,
} from "@/features/search/components/search-control.tsx";
import { searchSpotlight } from "@/features/search/constants.ts";
import { NotificationPopover } from "@/features/notification/components/notification-popover.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import { AiActivityPopover } from "@/features/ai/components/ai-activity-popover.tsx";

export function AppHeader() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);

  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const toggleDesktop = useToggleSidebar(desktopSidebarAtom);
  const { isTrial, trialDaysLeft } = useTrial();

  const isHomeRoute = location.pathname.startsWith("/home");
  const isSpacesRoute = location.pathname === "/spaces";
  const hideSidebar = isHomeRoute || isSpacesRoute;

  return (
    <>
      <Group justify="space-between" wrap={"nowrap"} className={classes.root}>
        <Group wrap="nowrap" className={classes.left}>
          {!hideSidebar && (
            <>
              <Tooltip label={t("Sidebar toggle")}>
                <SidebarToggle
                  aria-label={t("Sidebar toggle")}
                  aria-controls="docmost-primary-sidebar"
                  aria-expanded={mobileOpened}
                  opened={mobileOpened}
                  onClick={toggleMobile}
                  hiddenFrom="sm"
                  size="sm"
                />
              </Tooltip>

              <Tooltip label={t("Sidebar toggle")}>
                <SidebarToggle
                  aria-label={t("Sidebar toggle")}
                  aria-controls="docmost-primary-sidebar"
                  aria-expanded={desktopOpened}
                  opened={desktopOpened}
                  onClick={toggleDesktop}
                  visibleFrom="sm"
                  size="sm"
                />
              </Tooltip>
            </>
          )}

          <Text
            size="lg"
            fw={600}
            style={{ cursor: "pointer", userSelect: "none" }}
            component={Link}
            to="/home"
            className={classes.brand}
          >
            Docmost
          </Text>
        </Group>

        <Group className={classes.search}>
          <Group visibleFrom="sm" className={classes.search}>
            <SearchControl onClick={searchSpotlight.open} />
          </Group>
          <Group hiddenFrom="sm">
            <SearchMobileControl onSearch={searchSpotlight.open} />
          </Group>
        </Group>

        <Group wrap="nowrap" className={classes.right}>
          <AiActivityPopover />
          <NotificationPopover />
          {isCloud() && isTrial && trialDaysLeft !== 0 && (
            <>
              {isAdmin ? (
                <Badge
                  variant="light"
                  style={{ cursor: "pointer" }}
                  component={Link}
                  to={APP_ROUTE.SETTINGS.WORKSPACE.BILLING}
                  visibleFrom="xs"
                >
                  {trialDaysLeft === 1
                    ? t("header.trial.oneDayLeft")
                    : t("header.trial.daysLeft", { count: trialDaysLeft })}
                </Badge>
              ) : (
                <Badge variant="light" visibleFrom="xs">
                  {trialDaysLeft === 1
                    ? t("header.trial.oneDayLeft")
                    : t("header.trial.daysLeft", { count: trialDaysLeft })}
                </Badge>
              )}
            </>
          )}
          <TopMenu />
        </Group>
      </Group>
    </>
  );
}
