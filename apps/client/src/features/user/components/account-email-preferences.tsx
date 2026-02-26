import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { DEFAULT_EMAIL_ENABLED } from "@/features/user/constants/email-preferences.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function AccountEmailPreferences() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const emailEnabled =
    user.settings?.preferences?.emailEnabled ?? DEFAULT_EMAIL_ENABLED;
  const [isEmailEnabled, setIsEmailEnabled] = useState(emailEnabled);

  useEffect(() => {
    if (isEmailEnabled !== emailEnabled) {
      setIsEmailEnabled(emailEnabled);
    }
  }, [emailEnabled, isEmailEnabled]);

  const handleEmailEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        const updatedUser = await updateUser({ emailEnabled: enabled });
        setIsEmailEnabled(enabled);
        setUser(updatedUser);
      } catch {
        setIsEmailEnabled(emailEnabled);
        notifications.show({
          color: "red",
          message: t("Failed to update email notification settings. Please try again."),
        });
      }
    },
    [emailEnabled, setUser, t],
  );

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Enable email notifications")}</Text>
        <Text size="sm" c="dimmed">
          {t("Receive account activity updates by email.")}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <Switch
          checked={isEmailEnabled}
          onChange={(event) => {
            void handleEmailEnabled(event.currentTarget.checked);
          }}
          aria-label={t("Toggle email notifications")}
        />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
