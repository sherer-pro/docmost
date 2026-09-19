import SettingsTitle from "@/components/settings/settings-title.tsx";
import WorkspaceNameForm from "@/features/workspace/components/settings/components/workspace-name-form";
import WorkspaceIcon from "@/features/workspace/components/settings/components/workspace-icon.tsx";
import { SettingsDraftProvider } from "@/features/space/components/settings/settings-draft";
import { useTranslation } from "react-i18next";
import { getAppName, isCloud } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import ManageHostname from "@/features/workspace/components/manage-hostname.tsx";
import { Divider, Paper, Stack, Text, Title } from "@mantine/core";
import PageHistoryRetentionForm from "@/features/workspace/components/settings/components/page-history-retention-form";

export default function WorkspaceSettings() {
  const { t } = useTranslation();
  return (
    <SettingsDraftProvider>
      <Helmet>
        <title>
          {t("Workspace settings")} - {getAppName()}
        </title>
      </Helmet>
      <SettingsTitle title={t("Workspace settings")} />
      <Text c="dimmed" size="sm" mb="lg">
        {t("spaceAdmin.workspaceScope")}
      </Text>
      <Stack gap="lg">
        <Paper withBorder p="lg">
          <Stack gap="lg">
            <Title order={2} size="h4">
              {t("spaceAdmin.workspaceIdentity")}
            </Title>
            <WorkspaceIcon />
            <Text c="dimmed" size="sm">
              {t("spaceAdmin.iconImmediate")}
            </Text>
            <WorkspaceNameForm />
          </Stack>
        </Paper>
        <Paper withBorder p="lg">
          <Stack gap="md">
            <Title order={2} size="h4">
              {t("spaceAdmin.history")}
            </Title>
            <Text c="dimmed" size="sm">
              {t("spaceAdmin.historyScope")}
            </Text>
            <PageHistoryRetentionForm />
          </Stack>
        </Paper>

        {isCloud() && (
          <>
            <Divider />
            <ManageHostname />
          </>
        )}
      </Stack>
    </SettingsDraftProvider>
  );
}
