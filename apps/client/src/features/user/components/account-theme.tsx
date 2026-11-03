import {
  Text,
  useMantineColorScheme,
  Select,
  MantineColorScheme,
} from "@mantine/core";
import {
  ResponsiveSettingsRow,
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
} from "@/components/ui/responsive-settings-row";
import { useTranslation } from "react-i18next";

export default function AccountTheme() {
  const { t } = useTranslation();

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Theme")}</Text>
        <Text size="sm" c="dimmed">
          {t("Choose your preferred color scheme.")}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl>
        <ThemeSwitcher />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}

function ThemeSwitcher() {
  const { t } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  const handleChange = (value: MantineColorScheme) => {
    setColorScheme(value);
  };

  return (
    <Select
      w="100%"
      label={t("Select theme")}
      data={[
        { value: "light", label: t("Light") },
        { value: "dark", label: t("Dark") },
        { value: "auto", label: t("System settings") },
      ]}
      value={colorScheme}
      onChange={handleChange}
      allowDeselect={false}
      checkIconPosition="right"
    />
  );
}
