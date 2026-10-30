import { Select } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { updateWorkspace } from "@/features/workspace/services/workspace-service";
import useUserRole from "@/hooks/use-user-role";
import {
  SettingsSaveBar,
  useSettingsDraft,
} from "@/features/space/components/settings/settings-draft";

export default function DefaultPageEditModeForm() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();
  const form = useSettingsDraft<"read" | "edit">(
    workspace?.settings?.editor?.defaultPageEditMode ?? "read",
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.save(async (value) => {
          const updated = await updateWorkspace({ defaultPageEditMode: value });
          setWorkspace(updated);
          notifications.show({ message: t("Updated successfully") });
          return updated.settings?.editor?.defaultPageEditMode ?? "read";
        });
      }}
    >
      <Select
        label={t("docBlocks.initialEditMode")}
        description={t("docBlocks.initialEditModeDescription")}
        data={[
          { value: "read", label: t("Read") },
          { value: "edit", label: t("Edit") },
        ]}
        readOnly={!isAdmin}
        disabled={form.pending}
        allowDeselect={false}
        value={form.value}
        onChange={(value) =>
          (value === "read" || value === "edit") && form.setValue(value)
        }
      />
      {isAdmin && <SettingsSaveBar {...form} onCancel={() => form.reset()} />}
    </form>
  );
}
