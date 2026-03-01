import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { DEFAULT_REMEMBER_PAGE_SCROLL_POSITION } from "@/features/user/constants/scroll-preferences.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function AccountScrollPreferences() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const rememberPageScrollPosition =
    user.settings?.preferences?.rememberPageScrollPosition ??
    DEFAULT_REMEMBER_PAGE_SCROLL_POSITION;
  const [isRememberPageScrollPosition, setIsRememberPageScrollPosition] =
    useState(rememberPageScrollPosition);

  useEffect(() => {
    if (isRememberPageScrollPosition !== rememberPageScrollPosition) {
      setIsRememberPageScrollPosition(rememberPageScrollPosition);
    }
  }, [isRememberPageScrollPosition, rememberPageScrollPosition]);

  const handleRememberPageScrollPosition = useCallback(
    async (enabled: boolean) => {
      try {
        const updatedUser = await updateUser({
          rememberPageScrollPosition: enabled,
        });
        setIsRememberPageScrollPosition(enabled);
        setUser(updatedUser);
      } catch {
        setIsRememberPageScrollPosition(rememberPageScrollPosition);
        notifications.show({
          color: "red",
          message: t("Failed to update scroll position preference. Please try again."),
        });
      }
    },
    [rememberPageScrollPosition, setUser, t],
  );

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Remember scroll position")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Save your last position on each page and restore it after navigation or reload.",
          )}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <Switch
          checked={isRememberPageScrollPosition}
          onChange={(event) => {
            void handleRememberPageScrollPosition(event.currentTarget.checked);
          }}
          aria-label={t("Toggle remember scroll position")}
        />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
