import SettingsTitle from "@/components/settings/settings-title.tsx";
import WorkspaceNameForm from "@/features/workspace/components/settings/components/workspace-name-form";
import WorkspaceIcon from "@/features/workspace/components/settings/components/workspace-icon.tsx";
import WorkspaceTagsSettings from "@/features/workspace/components/settings/components/workspace-tags-settings";
import { PageTemplateWorkspacePolicySettings } from "@/features/page-template/components/page-template-policy-settings";
import { useTranslation } from "react-i18next";
import { getAppName, isCloud } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import ManageHostname from "@/features/workspace/components/manage-hostname.tsx";
import { Divider, Stack } from "@mantine/core";

export default function WorkspaceSettings() {
  const { t } = useTranslation();
  return (
    <>
      <Helmet>
        <title>
          {t("Workspace settings")} - {getAppName()}
        </title>
      </Helmet>
      <SettingsTitle title={t("General")} />
      <Stack gap="lg">
        <WorkspaceIcon />
        <Divider />
        <WorkspaceNameForm />
        <Divider />
        <WorkspaceTagsSettings />
        <Divider />
        <PageTemplateWorkspacePolicySettings />

        {isCloud() && (
          <>
            <Divider />
            <ManageHostname />
          </>
        )}
      </Stack>
    </>
  );
}
