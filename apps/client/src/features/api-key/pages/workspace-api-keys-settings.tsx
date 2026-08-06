import { Tabs, Text } from "@mantine/core";
import { IconDatabase, IconPlugConnected } from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import { WorkspaceApiKeysPanel } from "@/features/api-key/pages/workspace-api-keys.tsx";
import {
  API_KEYS_SETTINGS_DEFAULT_TAB,
  isApiKeysSettingsTab,
} from "@/features/api-key/utils/api-keys-settings-tabs.ts";

export default function WorkspaceApiKeysSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { keyType } = useParams();

  if (!isApiKeysSettingsTab(keyType)) {
    return (
      <Navigate to={`/settings/keys/${API_KEYS_SETTINGS_DEFAULT_TAB}`} replace />
    );
  }

  return (
    <>
      <Helmet>
        <title>
          {t("API keys")} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={t("API keys")} />

      <Tabs
        value={keyType}
        onChange={(value) => {
          if (isApiKeysSettingsTab(value)) {
            navigate(`/settings/keys/${value}`);
          }
        }}
      >
        <Tabs.List>
          <Tabs.Tab
            value="mcp"
            leftSection={<IconPlugConnected size={18} stroke={2} />}
          >
            <Text size="sm" fw={500}>
              {t("MCP")}
            </Text>
          </Tabs.Tab>
          <Tabs.Tab
            value="rag"
            leftSection={<IconDatabase size={18} stroke={2} />}
          >
            <Text size="sm" fw={500}>
              {t("RAG sync")}
            </Text>
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="mcp" pt="md">
          {keyType === "mcp" && (
            <WorkspaceApiKeysPanel key="mcp" keyType="mcp" />
          )}
        </Tabs.Panel>
        <Tabs.Panel value="rag" pt="md">
          {keyType === "rag" && (
            <WorkspaceApiKeysPanel key="rag" keyType="rag" />
          )}
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
