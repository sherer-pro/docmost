import { Group, Text, Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { updateUser } from "../services/user-service";
import { useAtom } from "jotai";
import { userAtom } from "../atoms/current-user-atom";
import { useState } from "react";
import { notifications } from "@mantine/notifications";

export default function AccountLanguage() {
  const { t } = useTranslation();

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Language")}</Text>
        <Text size="sm" c="dimmed">
          {t("Choose your preferred interface language.")}
        </Text>
      </div>
      <LanguageSwitcher />
    </Group>
  );
}

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const [language, setLanguage] = useState(
    user?.locale === "en" ? "en-US" : user?.locale,
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = async (value: string | null) => {
    if (!value || value === language) {
      return;
    }

    setIsSaving(true);
    try {
      const updatedUser = await updateUser({ locale: value });

      setLanguage(value);
      setUser(updatedUser);
      await i18n.changeLanguage(value);
    } catch {
      notifications.show({
        color: "red",
        message: t("Failed to update data"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Select
      label={t("Select language")}
      data={[
        { value: "en-US", label: t("accountLanguage.locale.enUS") },
        { value: "es-ES", label: t("accountLanguage.locale.esES") },
        { value: "de-DE", label: t("accountLanguage.locale.deDE") },
        { value: "fr-FR", label: t("accountLanguage.locale.frFR") },
        { value: "nl-NL", label: t("accountLanguage.locale.nlNL") },
        { value: "pt-BR", label: t("accountLanguage.locale.ptBR") },
        { value: "it-IT", label: t("accountLanguage.locale.itIT") },
        { value: "ja-JP", label: t("accountLanguage.locale.jaJP") },
        { value: "ko-KR", label: t("accountLanguage.locale.koKR") },
        { value: "uk-UA", label: t("accountLanguage.locale.ukUA") },
        { value: "ru-RU", label: t("accountLanguage.locale.ruRU") },
        { value: "zh-CN", label: t("accountLanguage.locale.zhCN") },
      ]}
      value={language || "en-US"}
      disabled={isSaving}
      aria-busy={isSaving}
      onChange={(value) => void handleChange(value)}
      allowDeselect={false}
      checkIconPosition="right"
    />
  );
}
