import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { useAtom } from "jotai";
import { updateWorkspace } from "@/features/workspace/services/workspace-service";
import { TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import useUserRole from "@/hooks/use-user-role";
import { useTranslation } from "react-i18next";
import {
  SettingsSaveBar,
  useSettingsDraft,
} from "@/features/space/components/settings/settings-draft";

export default function WorkspaceNameForm() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();
  const form = useSettingsDraft(workspace?.name ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.value.trim()) return;
        void form.save(async (name) => {
          const updated = await updateWorkspace({ name: name.trim() });
          setWorkspace(updated);
          notifications.show({ message: t("Updated successfully") });
          return updated.name;
        });
      }}
    >
      <TextInput
        label={t("Workspace Name")}
        value={form.value}
        required
        maxLength={250}
        readOnly={!isAdmin}
        disabled={form.pending}
        onChange={(event) => form.setValue(event.currentTarget.value)}
      />
      {isAdmin && <SettingsSaveBar {...form} onCancel={() => form.reset()} />}
    </form>
  );
}
