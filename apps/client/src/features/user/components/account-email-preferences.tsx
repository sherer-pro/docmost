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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsEmailEnabled(emailEnabled);
  }, [emailEnabled]);

  const handleEmailEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled === isEmailEnabled) {
        return;
      }

      const previousEmailEnabled = isEmailEnabled;
      setIsSaving(true);
      setIsEmailEnabled(enabled);

      try {
        const updatedUser = await updateUser({ emailEnabled: enabled });
        setUser(updatedUser);
        setIsEmailEnabled(
          updatedUser.settings?.preferences?.emailEnabled ?? DEFAULT_EMAIL_ENABLED,
        );
      } catch {
        setIsEmailEnabled(previousEmailEnabled);
        notifications.show({
          color: "red",
          message: t("Failed to update email notification settings. Please try again."),
        });
      } finally {
        setIsSaving(false);
      }
    },
    [isEmailEnabled, setUser, t],
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
          disabled={isSaving}
          onChange={(event) => {
            void handleEmailEnabled(event.currentTarget.checked);
          }}
          aria-busy={isSaving}
          aria-label={t("Toggle email notifications")}
        />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
