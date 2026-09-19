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

const KEEP_FOREVER = "forever";
const RETENTION_OPTIONS = [30, 90, 180, 365, 730, 3650];

export default function PageHistoryRetentionForm() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();
  const form = useSettingsDraft(
    workspace?.pageHistoryRetentionDays?.toString() ?? KEEP_FOREVER,
  );
  const days = [
    ...new Set([
      ...RETENTION_OPTIONS,
      ...(form.value !== KEEP_FOREVER ? [Number(form.value)] : []),
    ]),
  ].sort((a, b) => a - b);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.save(async (value) => {
          const updated = await updateWorkspace({
            pageHistoryRetentionDays:
              value === KEEP_FOREVER ? null : Number(value),
          });
          setWorkspace(updated);
          notifications.show({ message: t("Updated successfully") });
          return updated.pageHistoryRetentionDays?.toString() ?? KEEP_FOREVER;
        });
      }}
    >
      <Select
        label={t("Page history retention (days)")}
        data={[
          { value: KEEP_FOREVER, label: t("Keep forever") },
          ...days.map((day) => ({ value: String(day), label: String(day) })),
        ]}
        readOnly={!isAdmin}
        disabled={form.pending}
        allowDeselect={false}
        value={form.value}
        onChange={(value) => value && form.setValue(value)}
      />
      {isAdmin && <SettingsSaveBar {...form} onCancel={() => form.reset()} />}
    </form>
  );
}
