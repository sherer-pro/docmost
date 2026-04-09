import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import {
  DEFAULT_EMAIL_ENABLED,
  DEFAULT_EMAIL_FREQUENCY,
} from "@/features/user/constants/email-preferences.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { EmailFrequency } from "@/features/user/types/user.types.ts";
import { Select, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const EMAIL_FREQUENCY_OPTIONS: { value: EmailFrequency; labelKey: string }[] = [
  { value: "immediate", labelKey: "Immediately" },
  { value: "1h", labelKey: "Every hour" },
  { value: "3h", labelKey: "Every 3 hours" },
  { value: "6h", labelKey: "Every 6 hours" },
  { value: "24h", labelKey: "Every 24 hours" },
];

export default function AccountEmailPreferences() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const emailEnabled =
    user.settings?.preferences?.emailEnabled ?? DEFAULT_EMAIL_ENABLED;
  const emailFrequency =
    user.settings?.preferences?.emailFrequency ?? DEFAULT_EMAIL_FREQUENCY;
  const [isEmailEnabled, setIsEmailEnabled] = useState(emailEnabled);
  const [selectedFrequency, setSelectedFrequency] =
    useState<EmailFrequency>(emailFrequency);
  const [isSavingEmailEnabled, setIsSavingEmailEnabled] = useState(false);
  const [isSavingFrequency, setIsSavingFrequency] = useState(false);

  useEffect(() => {
    setIsEmailEnabled(emailEnabled);
  }, [emailEnabled]);

  useEffect(() => {
    setSelectedFrequency(emailFrequency);
  }, [emailFrequency]);

  const frequencyData = useMemo(
    () =>
      EMAIL_FREQUENCY_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );

  const handleEmailEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled === isEmailEnabled) {
        return;
      }

      const previousEmailEnabled = isEmailEnabled;
      setIsSavingEmailEnabled(true);
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
        setIsSavingEmailEnabled(false);
      }
    },
    [isEmailEnabled, setUser, t],
  );

  const handleFrequencyChange = useCallback(
    async (value: string | null) => {
      if (!value || value === selectedFrequency) {
        return;
      }

      const frequency = value as EmailFrequency;
      setSelectedFrequency(frequency);
      setIsSavingFrequency(true);

      try {
        const updatedUser = await updateUser({ emailFrequency: frequency });
        setUser(updatedUser);
        setSelectedFrequency(
          updatedUser.settings?.preferences?.emailFrequency ??
            DEFAULT_EMAIL_FREQUENCY,
        );
      } catch {
        setSelectedFrequency(emailFrequency);
        notifications.show({
          color: "red",
          message: t("Failed to update email notification settings. Please try again."),
        });
      } finally {
        setIsSavingFrequency(false);
      }
    },
    [emailFrequency, selectedFrequency, setUser, t],
  );

  const isEmailPreferencesBusy = isSavingEmailEnabled || isSavingFrequency;

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
          disabled={isEmailPreferencesBusy}
          onChange={(event) => {
            void handleEmailEnabled(event.currentTarget.checked);
          }}
          aria-busy={isEmailPreferencesBusy}
          aria-label={t("Toggle email notifications")}
        />

        {isEmailEnabled && (
          <Select
            mt="sm"
            data={frequencyData}
            value={selectedFrequency}
            disabled={isEmailPreferencesBusy}
            allowDeselect={false}
            onChange={handleFrequencyChange}
            aria-busy={isEmailPreferencesBusy}
            aria-label={t("Email notification frequency")}
          />
        )}
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
