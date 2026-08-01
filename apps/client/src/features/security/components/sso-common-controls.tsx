import { Button, Group, Switch, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import classes from "@/features/security/components/sso.module.css";

interface CommonSsoFormValues {
  groupSync?: boolean;
  allowSignup?: boolean;
  isEnabled?: boolean;
}

interface SsoCommonControlsProps<T extends CommonSsoFormValues> {
  form: UseFormReturnType<T>;
  isSaving: boolean;
}

export function SsoCommonControls<T extends CommonSsoFormValues>({
  form,
  isSaving,
}: SsoCommonControlsProps<T>) {
  const { t } = useTranslation();

  return (
    <>
      <Group justify="space-between">
        <div>
          <div>{t("Group sync")}</div>
          <Text size="xs" c="dimmed" maw={340}>
            {t(
              "Sync group membership from the provider using the mappings you define for this provider. Only memberships created by this provider are removed again.",
            )}
          </Text>
        </div>
        <Switch
          aria-label={t("Group sync")}
          className={classes.switch}
          {...form.getInputProps("groupSync", { type: "checkbox" })}
        />
      </Group>

      <Group justify="space-between">
        <div>{t("Allow signup")}</div>
        <Switch
          aria-label={t("Allow signup")}
          className={classes.switch}
          {...form.getInputProps("allowSignup", { type: "checkbox" })}
        />
      </Group>

      <Group justify="space-between">
        <div>{t("Enabled")}</div>
        <Switch
          aria-label={t("Enabled")}
          className={classes.switch}
          {...form.getInputProps("isEnabled", { type: "checkbox" })}
        />
      </Group>

      <Group mt="md" justify="flex-end">
        <Button type="submit" disabled={!form.isDirty()} loading={isSaving}>
          {t("Save")}
        </Button>
      </Group>
    </>
  );
}
