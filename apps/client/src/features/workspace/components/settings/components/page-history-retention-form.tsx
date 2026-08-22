import { Button, Group, Select, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
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
import useUserRole from "@/hooks/use-user-role";

const KEEP_FOREVER = "forever";
const RETENTION_OPTIONS = [30, 90, 180, 365, 730, 3650];

export default function PageHistoryRetentionForm() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [isLoading, setIsLoading] = useState(false);
  const { isAdmin } = useUserRole();
  const form = useForm({
    initialValues: {
      retentionDays:
        workspace?.pageHistoryRetentionDays?.toString() ?? KEEP_FOREVER,
    },
  });

  const options = [
    { value: KEEP_FOREVER, label: t("Keep forever") },
    ...RETENTION_OPTIONS.map((days) => ({
      value: days.toString(),
      label: days.toString(),
    })),
  ];

  const handleSubmit = form.onSubmit(async ({ retentionDays }) => {
    setIsLoading(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        pageHistoryRetentionDays:
          retentionDays === KEEP_FOREVER ? null : Number(retentionDays),
      });
      setWorkspace(updatedWorkspace);
      form.resetDirty();
      notifications.show({ message: t("Updated successfully") });
    } catch (error) {
      console.error(error);
      notifications.show({
        message: t("Failed to update data"),
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  });

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Page history retention (days)")}</Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl wide>
        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <Group gap="sm" align="flex-end" wrap="nowrap">
            <Select
              aria-label={t("Page history retention (days)")}
              data={options}
              readOnly={!isAdmin}
              allowDeselect={false}
              style={{ flex: 1 }}
              {...form.getInputProps("retentionDays")}
            />
            {isAdmin && (
              <Button
                type="submit"
                disabled={isLoading || !form.isDirty()}
                loading={isLoading}
              >
                {t("Save")}
              </Button>
            )}
          </Group>
        </form>
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
