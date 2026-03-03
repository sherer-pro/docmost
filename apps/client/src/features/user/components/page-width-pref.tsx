import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useUpdatePageMutation } from "@/features/page/queries/page-query.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import { MantineSize, Switch, Text } from "@mantine/core";
import { useAtom } from "jotai/index";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveSettingsRow, ResponsiveSettingsContent, ResponsiveSettingsControl } from "@/components/ui/responsive-settings-row";

export default function PageWidthPref() {
  const { t } = useTranslation();

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Full page width")}</Text>
        <Text size="sm" c="dimmed">
          {t("Choose your preferred page width.")}
        </Text>
      </ResponsiveSettingsContent>

      <ResponsiveSettingsControl>
        <PageWidthToggle scope="user" />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}

interface PageWidthToggleProps {
  size?: MantineSize;
  label?: string;
  scope?: "user" | "page";
  pageId?: string;
  checked?: boolean;
}

/**
 * The page width switch supports two independent scenarios:
 * - `scope="user"` - global user setting (default);
 * - `scope="page"` - local setting of a specific document.
 */
export function PageWidthToggle({
  size,
  label,
  scope = "user",
  pageId,
  checked,
}: PageWidthToggleProps) {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const { mutateAsync: updatePage } = useUpdatePageMutation();
  const [localChecked, setLocalChecked] = useState(
    checked ??
    user.settings?.preferences?.fullPageWidth,
  );

  const resolvedChecked = checked ?? localChecked;

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.checked;

    /**
     * In page mode, we save the setting directly in the document settings.
     * If the pageId is not available (for example, the document has not yet been initialized),
     * we safely skip the operation without crashing the UI.
     */
    if (scope === "page") {
      if (!pageId) {
        return;
      }

      await updatePage({
        pageId,
        settings: {
          fullPageWidth: value,
        },
      });

      setLocalChecked(value);
      return;
    }

    const updatedUser = await updateUser({ fullPageWidth: value });
    setLocalChecked(value);
    setUser(updatedUser);
  };

  return (
    <Switch
      size={size}
      label={label}
      labelPosition="left"
      checked={Boolean(resolvedChecked)}
      onChange={handleChange}
      aria-label={t("Toggle full page width")}
    />
  );
}
