import { Stack, Tabs, Text } from "@mantine/core";
import { IconShieldCheck, IconSparkles, IconTool } from "@tabler/icons-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import AiSpacesPanel from "@/features/ai/components/ai-spaces-panel.tsx";
import ExternalMcpSettingsPanel from "@/features/ai-external-mcp/components/external-mcp-settings-panel.tsx";
import { AiBuiltinToolWorkspacePolicy } from "@/features/ai/components/ai-builtin-tool-workspace-policy.tsx";
import {
  AI_SETTINGS_DEFAULT_TAB,
  isAiSettingsTab,
} from "@/features/ai/utils/ai-settings-tabs.ts";
import classes from "./ai-integrations-settings.module.css";

export default function AiIntegrationsSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { aiTab } = useParams();

  if (!isAiSettingsTab(aiTab)) {
    return <Navigate to={`/settings/ai/${AI_SETTINGS_DEFAULT_TAB}`} replace />;
  }

  return (
    <Stack gap="xl" className={classes.page}>
      <Helmet>
        <title>
          {t("ai.title")} - {getAppName()}
        </title>
      </Helmet>
      <div>
        <SettingsTitle title={t("ai.title")} />
        <Text c="dimmed" maw={720}>
          {t("ai.integrations.description")}
        </Text>
      </div>

      <Tabs
        value={aiTab}
        variant="pills"
        keepMounted={false}
        onChange={(value) => {
          if (isAiSettingsTab(value)) {
            navigate(`/settings/ai/${value}`);
          }
        }}
      >
        <Tabs.List className={classes.tabList}>
          <Tabs.Tab
            value="spaces"
            leftSection={<IconSparkles size={18} stroke={2} />}
            className={classes.tab}
          >
            <Text size="sm" fw={500}>
              {t("ai.integrations.spacesTitle")}
            </Text>
          </Tabs.Tab>
          <Tabs.Tab
            value="built-in-tools"
            leftSection={<IconShieldCheck size={18} stroke={2} />}
            className={classes.tab}
          >
            <Text size="sm" fw={500}>
              {t("ai.toolPolicy.workspaceTitle")}
            </Text>
          </Tabs.Tab>
          {/* Deliberately not IconPlugConnected: that icon already marks the
              inbound MCP surface under /settings/keys/mcp. */}
          <Tabs.Tab
            value="external-tools"
            leftSection={<IconTool size={18} stroke={2} />}
            className={classes.tab}
          >
            <Text size="sm" fw={500}>
              {t("ai.externalTools.title")}
            </Text>
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="spaces" className={classes.tabPanel}>
          <AiSpacesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="built-in-tools" className={classes.tabPanel}>
          <AiBuiltinToolWorkspacePolicy />
        </Tabs.Panel>
        <Tabs.Panel value="external-tools" className={classes.tabPanel}>
          <ExternalMcpSettingsPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
