import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { PushFrequency } from "@/features/user/types/user.types.ts";
import { Select, Switch, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const PUSH_FREQUENCY_OPTIONS: { value: PushFrequency; labelKey: string }[] = [
  { value: "immediate", labelKey: "Immediately" },
  { value: "1h", labelKey: "Every hour" },
  { value: "3h", labelKey: "Every 3 hours" },
  { value: "6h", labelKey: "Every 6 hours" },
  { value: "24h", labelKey: "Every 24 hours" },
];

function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (
    typeof window === "undefined" ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  return window.Notification.permission;
}

export default function AccountPushPreferences() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(getNotificationPermission());
  const pushEnabled = user.settings?.preferences?.pushEnabled ?? false;
  const pushFrequency =
    user.settings?.preferences?.pushFrequency ?? "immediate";
  const [isPushEnabled, setIsPushEnabled] = useState(pushEnabled);
  const [selectedFrequency, setSelectedFrequency] =
    useState<PushFrequency>(pushFrequency);

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  useEffect(() => {
    if (isPushEnabled !== pushEnabled) {
      setIsPushEnabled(pushEnabled);
    }
  }, [isPushEnabled, pushEnabled]);

  useEffect(() => {
    if (selectedFrequency !== pushFrequency) {
      setSelectedFrequency(pushFrequency);
    }
  }, [pushFrequency, selectedFrequency]);

  const frequencyData = useMemo(
    () =>
      PUSH_FREQUENCY_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );

  const handlePushEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled && permission !== "granted") {
        if (permission === "unsupported") {
          return;
        }

        const requestedPermission =
          await window.Notification.requestPermission();
        setPermission(requestedPermission);

        if (requestedPermission !== "granted") {
          const updatedUser = await updateUser({ pushEnabled: false });
          setIsPushEnabled(false);
          setUser(updatedUser);
          return;
        }
      }

      const updatedUser = await updateUser({ pushEnabled: enabled });
      setIsPushEnabled(enabled);
      setUser(updatedUser);
    },
    [permission, setUser],
  );

  const handleFrequencyChange = useCallback(
    async (value: string | null) => {
      if (!value) {
        return;
      }

      const frequency = value as PushFrequency;
      const updatedUser = await updateUser({ pushFrequency: frequency });
      setSelectedFrequency(frequency);
      setUser(updatedUser);
    },
    [setUser],
  );

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Enable push notifications")}</Text>
        <Text size="sm" c="dimmed">
          {t("Receive browser push notifications for activity updates.")}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <Switch
          checked={isPushEnabled}
          onChange={(event) => handlePushEnabled(event.currentTarget.checked)}
          aria-label={t("Toggle push notifications")}
        />

        {isPushEnabled && permission === "granted" && (
          <Select
            mt="sm"
            data={frequencyData}
            value={selectedFrequency}
            onChange={handleFrequencyChange}
            aria-label={t("Push notification frequency")}
          />
        )}
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
