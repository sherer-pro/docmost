import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useAtom } from "jotai";
import * as z from "zod";
import { useState } from "react";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { IWorkspace } from "@/features/workspace/types/workspace.types.ts";
import { Button, Group, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import useUserRole from "@/hooks/use-user-role.tsx";
import { useTranslation } from "react-i18next";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row.tsx";

const formSchema = z.object({
  name: z.string().min(1),
});

type FormValues = z.infer<typeof formSchema>;

export default function WorkspaceNameForm() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();

  const form = useForm<FormValues>({
    validate: zodResolver(formSchema),
    initialValues: {
      name: workspace?.name,
    },
  });

  async function handleSubmit(data: Partial<IWorkspace>) {
    setIsLoading(true);

    try {
      const updatedWorkspace = await updateWorkspace({ name: data.name });
      setWorkspace(updatedWorkspace);
      notifications.show({ message: t("Updated successfully") });
    } catch (err) {
      console.log(err);
      notifications.show({
        message: t("Failed to update data"),
        color: "red",
      });
    }
    setIsLoading(false);
    form.resetDirty();
  }

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Workspace Name")}</Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl wide>
        <form onSubmit={form.onSubmit(handleSubmit)} style={{ width: "100%" }}>
          <Group gap="sm" align="flex-end" wrap="nowrap">
            <TextInput
              id="name"
              aria-label={t("Workspace Name")}
              placeholder={t("e.g ACME")}
              variant="filled"
              readOnly={!isAdmin}
              style={{ flex: 1 }}
              {...form.getInputProps("name")}
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
