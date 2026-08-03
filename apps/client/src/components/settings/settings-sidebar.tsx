import React, { useEffect, useState } from "react";
import { Group, Text, ScrollArea, ActionIcon } from "@mantine/core";
import {
  IconUser,
  IconSettings,
  IconUsers,
  IconArrowLeft,
  IconUsersGroup,
  IconSpaces,
  IconBrush,
  IconLock,
  IconWorld,
  IconSparkles,
  IconKey,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router-dom";
import classes from "./settings.module.css";
import { useTranslation } from "react-i18next";
import { isCloud } from "@/lib/config.ts";
import useUserRole from "@/hooks/use-user-role.tsx";
import { useAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import {
  currentUserAtom,
} from "@/features/user/atoms/current-user-atom.ts";
import {
  prefetchApiKeyManagement,
  prefetchGroups,
  prefetchShares,
  prefetchSpaces,
  prefetchSsoProviders,
  prefetchWorkspaceMembers,
} from "@/components/settings/settings-queries.tsx";
import AppVersion from "@/components/settings/app-version.tsx";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import { useSettingsNavigation } from "@/hooks/use-settings-navigation";
import { getGroups } from "@/features/group/services/group-service.ts";
import {
  canAccessSettingsPath,
  isSettingsItemActive,
} from "@/components/settings/workspace-settings-access.ts";

interface DataItem {
  label: string;
  icon: React.ElementType;
  path: string;
  isAdmin?: boolean;
}

interface DataGroup {
  heading: string;
  items: DataItem[];
}

const groupedData: DataGroup[] = [
  {
    heading: "Account",
    items: [
      { label: "Profile", icon: IconUser, path: "/settings/account/profile" },
      {
        label: "Preferences",
        icon: IconBrush,
        path: "/settings/account/preferences",
      },
    ],
  },
  {
    heading: "Workspace",
    items: [
      {
        label: "General",
        icon: IconSettings,
        path: "/settings/workspace",
        isAdmin: true,
      },
      {
        label: "Members",
        icon: IconUsers,
        path: "/settings/members",
      },
      {
        label: "Security & SSO",
        icon: IconLock,
        path: "/settings/security",
        isAdmin: true,
      },
      { label: "Groups", icon: IconUsersGroup, path: "/settings/groups" },
      { label: "Spaces", icon: IconSpaces, path: "/settings/spaces" },
      { label: "Public sharing", icon: IconWorld, path: "/settings/sharing" },
      {
        label: "ai.title",
        icon: IconSparkles,
        path: "/settings/ai",
        isAdmin: true,
      },
      {
        label: "API keys",
        icon: IconKey,
        path: "/settings/keys",
        isAdmin: true,
      },
    ],
  },
];

export default function SettingsSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [active, setActive] = useState(location.pathname);
  const { goBack } = useSettingsNavigation();
  const { isAdmin } = useUserRole();
  const [currentUser] = useAtom(currentUserAtom);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const { data: groups } = useQuery({
    queryKey: ["groups", { limit: 1 }],
    queryFn: () => getGroups({ limit: 1 }),
  });

  useEffect(() => {
    setActive(location.pathname);
  }, [location.pathname]);

  /**
   * Checks whether a specific settings item should be visible.
   *
   * Also hides the "Members" item for member users
   * who cannot access the members directory (no non-default groups).
   */
  const canShowItem = (item: DataItem) => {
    if (!canAccessSettingsPath(item.path, isAdmin)) {
      return false;
    }

    if (
      item.path === "/settings/members" &&
      currentUser?.user?.canAccessMembersDirectory === false
    ) {
      return false;
    }

    if (item.path === "/settings/groups" && groups?.items.length === 0) {
      return false;
    }

    if (item.isAdmin) {
      return isAdmin;
    }

    return true;
  };

  const menuItems = groupedData.map((group) => {
    return (
      <div key={group.heading}>
        <Text c="dimmed" className={classes.linkHeader}>
          {t(group.heading)}
        </Text>
        {group.items.map((item) => {
          if (!canShowItem(item)) {
            return null;
          }

          let prefetchHandler: any;
          switch (item.label) {
            case "Members":
              prefetchHandler = prefetchWorkspaceMembers;
              break;
            case "Spaces":
              prefetchHandler = prefetchSpaces;
              break;
            case "Groups":
              prefetchHandler = prefetchGroups;
              break;
            case "Security & SSO":
              prefetchHandler = prefetchSsoProviders;
              break;
            case "Public sharing":
              prefetchHandler = prefetchShares;
              break;
            case "API keys":
              prefetchHandler = () => prefetchApiKeyManagement("mcp");
              break;
            default:
              break;
          }

          return (
            <Link
              onMouseEnter={prefetchHandler}
              className={classes.link}
              data-active={
                isSettingsItemActive(active, item.path) || undefined
              }
              key={item.label}
              to={item.path}
              onClick={() => {
                if (mobileSidebarOpened) {
                  toggleMobileSidebar();
                }
              }}
            >
              <item.icon className={classes.linkIcon} stroke={2} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </div>
    );
  });

  return (
    <div className={classes.navbar}>
      <Group className={classes.title} justify="flex-start">
        <ActionIcon
          onClick={() => {
            goBack();
            if (mobileSidebarOpened) {
              toggleMobileSidebar();
            }
          }}
          variant="transparent"
          c="gray"
          aria-label={t("apiKeys.back")}
        >
          <IconArrowLeft stroke={2} />
        </ActionIcon>
        <Text fw={500}>{t("Settings")}</Text>
      </Group>

      <ScrollArea w="100%">{menuItems}</ScrollArea>

      {!isCloud() && <AppVersion />}

      {isCloud() && (
        <div className={classes.text}>
          <Text
            size="sm"
            c="dimmed"
            component="a"
            href="mailto:help@docmost.com"
          >
            help@docmost.com
          </Text>
        </div>
      )}
    </div>
  );
}
