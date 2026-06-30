import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { Switch, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function FixedToolbarPref() {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const fixedToolbar = Boolean(user?.settings?.preferences?.fixedToolbar);
  const [checked, setChecked] = useState(fixedToolbar);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setChecked(fixedToolbar);
  }, [fixedToolbar]);

  const handleChange = async (value: boolean) => {
    const previous = checked;
    setChecked(value);
    setIsSaving(true);

    try {
      const updatedUser = await updateUser({ fixedToolbar: value });
      setUser(updatedUser);
      setChecked(Boolean(updatedUser.settings?.preferences?.fixedToolbar));
    } catch {
      setChecked(previous);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Fixed editor toolbar")}</Text>
        <Text size="sm" c="dimmed">
          {t("Always show the formatting toolbar above the editor.")}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <Switch
          checked={checked}
          disabled={isSaving}
          onChange={(event) => void handleChange(event.currentTarget.checked)}
          aria-busy={isSaving}
          aria-label={t("Fixed editor toolbar")}
        />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
