import { Checkbox, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { builtInTagDefinitions } from "@docmost/editor-ext";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { updateWorkspace } from "@/features/workspace/services/workspace-service";
import { normalizeDisabledTags } from "@/features/editor/components/tag/tag-settings";
import useUserRole from "@/hooks/use-user-role";

export default function WorkspaceTagsSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [isSaving, setIsSaving] = useState(false);
  const disabledTags = normalizeDisabledTags(
    workspace?.settings?.tags?.disabled,
  );

  const handleToggle = async (value: string, checked: boolean) => {
    const nextDisabled = checked
      ? disabledTags.filter((tag) => tag !== value)
      : [...disabledTags, value];

    setIsSaving(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        tagSettings: { disabled: nextDisabled },
      });
      setWorkspace(updatedWorkspace);
      notifications.show({ message: t("Updated successfully") });
    } catch (err) {
      console.log(err);
      notifications.show({
        message: t("Failed to update data"),
        color: "red",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Tags")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Choose which built-in tags are available in the editor slash menu.",
          )}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl wide>
        <Stack gap="xs">
          {builtInTagDefinitions.map((tag) => (
            <Checkbox
              key={tag.value}
              label={t(tag.titleKey)}
              description={t(tag.menuDescriptionKey)}
              checked={!disabledTags.includes(tag.value)}
              disabled={!isAdmin || isSaving}
              onChange={(event) =>
                handleToggle(tag.value, event.currentTarget.checked)
              }
            />
          ))}
        </Stack>
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
