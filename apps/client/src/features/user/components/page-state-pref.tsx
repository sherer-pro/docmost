import { Text, MantineSize, SegmentedControl } from "@mantine/core";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { normalizePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
import { ResponsiveSettingsRow, ResponsiveSettingsContent, ResponsiveSettingsControl } from "@/components/ui/responsive-settings-row";

export default function PageStatePref() {
  const { t } = useTranslation();

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Default page edit mode")}</Text>
        <Text size="sm" c="dimmed">
          {t("Choose your preferred page edit mode. Avoid accidental edits.")}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <PageStateSegmentedControl />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}

interface PageStateSegmentedControlProps {
  size?: MantineSize;
}

export function PageStateSegmentedControl({
  size,
}: PageStateSegmentedControlProps) {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const pageEditMode = normalizePageEditMode(
    user?.settings?.preferences?.pageEditMode,
  );
  const [value, setValue] = useState(pageEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const latestRequestIdRef = useRef(0);

  const setLocalPreference = useCallback(
    (mode: PageEditMode) => {
      if (!user) {
        return;
      }

      setUser({
        ...user,
        settings: {
          ...user.settings,
          preferences: {
            ...user.settings?.preferences,
            pageEditMode: mode,
          },
        },
      });
    },
    [setUser, user],
  );

  const handleChange = useCallback(
    async (nextValue: string) => {
      const nextMode = normalizePageEditMode(nextValue);
      if (!user || nextMode === value) {
        return;
      }

      const previousMode = value;
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      setValue(nextMode);
      setLocalPreference(nextMode);
      setIsSaving(true);

      try {
        const updatedUser = await updateUser({ pageEditMode: nextMode });
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        const persistedMode = normalizePageEditMode(
          updatedUser?.settings?.preferences?.pageEditMode,
        );

        setValue(persistedMode);
        setUser({
          ...updatedUser,
          settings: {
            ...updatedUser.settings,
            preferences: {
              ...updatedUser.settings?.preferences,
              pageEditMode: persistedMode,
            },
          },
        });
      } catch {
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        setValue(previousMode);
        setLocalPreference(previousMode);
      } finally {
        if (requestId === latestRequestIdRef.current) {
          setIsSaving(false);
        }
      }
    },
    [setLocalPreference, setUser, user, value],
  );

  useEffect(() => {
    setValue(pageEditMode);
  }, [pageEditMode]);

  return (
    <SegmentedControl
      size={size}
      value={value}
      onChange={handleChange}
      aria-busy={isSaving}
      data={[
        { label: t("Edit"), value: PageEditMode.Edit },
        { label: t("Read"), value: PageEditMode.Read },
      ]}
    />
  );
}
