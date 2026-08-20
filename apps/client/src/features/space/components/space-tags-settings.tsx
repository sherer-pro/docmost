import { Checkbox, Stack, Text } from "@mantine/core";
import {
  builtInTagDefinitions,
  type BuiltInTagValue,
} from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { normalizeDisabledTags } from "@/features/editor/components/tag/tag-settings";
import type { ISpaceTagSettings } from "@/features/space/types/space.types";

interface SpaceTagsSettingsProps {
  settings?: ISpaceTagSettings;
  disabled?: boolean;
  onChange: (settings: ISpaceTagSettings) => void;
}

export default function SpaceTagsSettings({
  settings,
  disabled = false,
  onChange,
}: SpaceTagsSettingsProps) {
  const { t } = useTranslation();
  const disabledTags = normalizeDisabledTags(settings?.disabled);

  const handleToggle = (value: BuiltInTagValue, checked: boolean) => {
    onChange({
      disabled: checked
        ? disabledTags.filter((tag) => tag !== value)
        : [...disabledTags, value],
    });
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
              disabled={disabled}
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
