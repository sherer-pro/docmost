import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import {
  createPushSubscription,
  getNotificationPermission,
  removePushSubscription,
  requestNotificationPermission,
} from "@/lib/pwa/push-subscription";
import { PushFrequency } from "@/features/user/types/user.types.ts";
import {
  DEFAULT_PUSH_ENABLED,
  DEFAULT_PUSH_FREQUENCY,
} from "@/features/user/constants/push-preferences.ts";
import { Select, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
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

export default function AccountPushPreferences() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(getNotificationPermission());
  const pushEnabled = user.settings?.preferences?.pushEnabled ?? DEFAULT_PUSH_ENABLED;
  const pushFrequency =
    user.settings?.preferences?.pushFrequency ?? DEFAULT_PUSH_FREQUENCY;
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
      try {
        if (enabled) {
          if (permission === "unsupported") {
            notifications.show({
              color: "red",
              message: t("Push notifications are not supported in this browser."),
            });
            setIsPushEnabled(false);
            return;
          }

          const requestedPermission = await requestNotificationPermission();
          setPermission(requestedPermission);

          if (requestedPermission !== "granted") {
            setIsPushEnabled(false);
            notifications.show({
              color: "red",
              message: t(
                "Push permission is blocked. Enable notifications in browser settings.",
              ),
            });
            return;
          }

          try {
            await createPushSubscription();
          } catch {
            setIsPushEnabled(false);
            notifications.show({
              color: "red",
              message: t("Failed to enable push notifications. Please try again."),
            });
            return;
          }

          const updatedUser = await updateUser({ pushEnabled: true });
          setIsPushEnabled(true);
          setUser(updatedUser);
          return;
        }

        // First try to remove the browser subscription, but do not block disabling
        // the account setting if the browser operation fails.
        let removeSubscriptionFailed = false;
        try {
          await removePushSubscription();
        } catch {
          removeSubscriptionFailed = true;
        }

        // Persist the user setting on the server separately so push
        // is disabled in the account even if the browser-side step partially fails.
        const updatedUser = await updateUser({ pushEnabled: false });
        setIsPushEnabled(false);
        setUser(updatedUser);

        if (removeSubscriptionFailed) {
          notifications.show({
            color: "yellow",
            message: t(
              "Browser subscription was not removed, but push was disabled in your account.",
            ),
          });
        }
      } catch {
        setIsPushEnabled(pushEnabled);
        notifications.show({
          color: "red",
          message: t("Failed to update push notification settings. Please try again."),
        });
      }
    },
    [permission, pushEnabled, setUser, t],
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
          onChange={(event) => {
            void handlePushEnabled(event.currentTarget.checked).catch(() => {
              // The error is already handled inside handlePushEnabled, so here
              // we suppress unhandled rejection to keep UI state stable.
            });
          }}
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
