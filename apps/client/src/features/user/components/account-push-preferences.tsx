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
import {
  normalizePreferenceBoolean,
  normalizePushFrequency,
} from "@/features/user/utils/notification-preferences.ts";
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
  const pushEnabled = normalizePreferenceBoolean(
    user.settings?.preferences?.pushEnabled,
    DEFAULT_PUSH_ENABLED,
  );
  const pushFrequency = normalizePushFrequency(
    user.settings?.preferences?.pushFrequency,
    DEFAULT_PUSH_FREQUENCY,
  );
  const [isPushEnabled, setIsPushEnabled] = useState(pushEnabled);
  const [selectedFrequency, setSelectedFrequency] =
    useState<PushFrequency>(pushFrequency);
  const [isSavingPushEnabled, setIsSavingPushEnabled] = useState(false);
  const [isSavingFrequency, setIsSavingFrequency] = useState(false);

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  useEffect(() => {
    setIsPushEnabled(pushEnabled);
  }, [pushEnabled]);

  useEffect(() => {
    setSelectedFrequency(pushFrequency);
  }, [pushFrequency]);

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
      if (enabled === isPushEnabled) {
        return;
      }

      const previousPushEnabled = isPushEnabled;
      setIsSavingPushEnabled(true);
      setIsPushEnabled(enabled);

      try {
        if (enabled) {
          if (permission === "unsupported") {
            setIsPushEnabled(previousPushEnabled);
            notifications.show({
              color: "red",
              message: t("Push notifications are not supported in this browser."),
            });
            return;
          }

          const requestedPermission = await requestNotificationPermission();
          setPermission(requestedPermission);

          if (requestedPermission !== "granted") {
            setIsPushEnabled(previousPushEnabled);
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
            setIsPushEnabled(previousPushEnabled);
            notifications.show({
              color: "red",
              message: t("Failed to enable push notifications. Please try again."),
            });
            return;
          }

          const updatedUser = await updateUser({ pushEnabled: true });
          setUser(updatedUser);
          setIsPushEnabled(
            normalizePreferenceBoolean(
              updatedUser.settings?.preferences?.pushEnabled,
              DEFAULT_PUSH_ENABLED,
            ),
          );
          return;
        }

        let removeSubscriptionFailed = false;
        try {
          await removePushSubscription();
        } catch {
          removeSubscriptionFailed = true;
        }

        const updatedUser = await updateUser({ pushEnabled: false });
        setUser(updatedUser);
        setIsPushEnabled(
          normalizePreferenceBoolean(
            updatedUser.settings?.preferences?.pushEnabled,
            DEFAULT_PUSH_ENABLED,
          ),
        );

        if (removeSubscriptionFailed) {
          notifications.show({
            color: "yellow",
            message: t(
              "Browser subscription was not removed, but push was disabled in your account.",
            ),
          });
        }
      } catch {
        setIsPushEnabled(previousPushEnabled);
        notifications.show({
          color: "red",
          message: t("Failed to update push notification settings. Please try again."),
        });
      } finally {
        setIsSavingPushEnabled(false);
      }
    },
    [isPushEnabled, permission, setUser, t],
  );

  const handleFrequencyChange = useCallback(
    async (value: string | null) => {
      if (!value || value === selectedFrequency) {
        return;
      }

      const frequency = value as PushFrequency;
      setSelectedFrequency(frequency);
      setIsSavingFrequency(true);

      try {
        const updatedUser = await updateUser({ pushFrequency: frequency });
        setUser(updatedUser);
        setSelectedFrequency(
          normalizePushFrequency(
            updatedUser.settings?.preferences?.pushFrequency,
            DEFAULT_PUSH_FREQUENCY,
          ),
        );
      } catch {
        setSelectedFrequency(pushFrequency);
        notifications.show({
          color: "red",
          message: t("Failed to update push notification settings. Please try again."),
        });
      } finally {
        setIsSavingFrequency(false);
      }
    },
    [pushFrequency, selectedFrequency, setUser, t],
  );

  const isPushPreferencesBusy = isSavingPushEnabled || isSavingFrequency;

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
          disabled={isPushPreferencesBusy}
          onChange={(event) => {
            void handlePushEnabled(event.currentTarget.checked).catch(() => {
              // The handler already owns user-facing error handling.
            });
          }}
          aria-busy={isPushPreferencesBusy}
          aria-label={t("Toggle push notifications")}
        />

        {isPushEnabled && (
          <Select
            mt="sm"
            data={frequencyData}
            value={selectedFrequency}
            disabled={isPushPreferencesBusy}
            allowDeselect={false}
            onChange={handleFrequencyChange}
            aria-busy={isPushPreferencesBusy}
            aria-label={t("Push notification frequency")}
          />
        )}
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
