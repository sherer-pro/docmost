import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Text,
  Tabs,
} from "@mantine/core";
import { IconPlugConnected } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { EmptyState } from "@/components/ui/empty-state";
import useUserRole from "@/hooks/use-user-role";
import { formattedDate } from "@/lib/time";
import { useSearchParams } from 'react-router-dom';
import IntegrationPreviewConnections from '@/features/integration-preview/integration-preview-connections';
import {
  disconnectMcpOAuth,
  getMcpOAuthConnections,
  getMcpOAuthSettings,
  updateMcpOAuthSettings,
} from "./mcp-oauth-service";

function McpOAuthSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["mcp-oauth-settings"],
    queryFn: getMcpOAuthSettings,
  });
  const mutation = useMutation({
    mutationFn: updateMcpOAuthSettings,
    onSuccess: () =>
      client
        .invalidateQueries({ queryKey: ["mcp-oauth"] })
        .then(() =>
          client.invalidateQueries({ queryKey: ["mcp-oauth-settings"] }),
        ),
  });
  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Text fw={500}>{t("mcpOAuth.settingsTitle")}</Text>
        <Text size="sm" c="dimmed">
          {t("mcpOAuth.settingsDescription")}
        </Text>
        <Switch
          label={t("mcpOAuth.enabled")}
          checked={settings.data?.enabled ?? false}
          disabled={
            settings.isPending || settings.isError || mutation.isPending
          }
          onChange={(event) => mutation.mutate(event.currentTarget.checked)}
        />
        {(settings.isError || mutation.isError) && (
          <Alert color="red">{t("mcpOAuth.failed")}</Alert>
        )}
      </Stack>
    </Paper>
  );
}

export default function ConnectedApplications() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'previews' ? 'previews' : 'mcp';
  return <Stack><SettingsTitle title={t('mcpOAuth.title')} /><Tabs value={tab} onChange={(value) => setParams(value === 'previews' ? { tab: 'previews' } : {})}><Tabs.List><Tabs.Tab value="mcp">MCP</Tabs.Tab><Tabs.Tab value="previews">{t('integrationPreviews.title')}</Tabs.Tab></Tabs.List><Tabs.Panel value="mcp" pt="md">{tab === 'mcp' && <McpApplications />}</Tabs.Panel><Tabs.Panel value="previews" pt="md">{tab === 'previews' && <IntegrationPreviewConnections />}</Tabs.Panel></Tabs></Stack>;
}

function McpApplications() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const client = useQueryClient();
  const connections = useQuery({
    queryKey: ["mcp-oauth", "connections"],
    queryFn: getMcpOAuthConnections,
  });
  const disconnect = useMutation({
    mutationFn: disconnectMcpOAuth,
    onSuccess: () => client.invalidateQueries({ queryKey: ["mcp-oauth"] }),
  });
  return (
    <Stack>
      {isAdmin && <McpOAuthSettings />}
      <Text c="dimmed" size="sm">
        {t("mcpOAuth.sessionBound")}
      </Text>
      {connections.isPending ? (
        <Skeleton height={130} />
      ) : connections.isError ? (
        <EmptyState
          icon={IconPlugConnected}
          title={t("mcpOAuth.failed")}
          action={
            <Button onClick={() => connections.refetch()}>
              {t("mcpOAuth.reload")}
            </Button>
          }
        />
      ) : !connections.data?.length ? (
        <EmptyState
          icon={IconPlugConnected}
          title={t("mcpOAuth.noConnections")}
        />
      ) : (
        connections.data.map((connection) => (
          <Paper p="md" withBorder key={connection.id}>
            <Group justify="space-between" wrap="wrap">
              <Stack gap={4}>
                <Text fw={500}>{connection.clientName}</Text>
                <Text size="sm">{connection.spaceName}</Text>
                <Text size="xs" c="dimmed">
                  {formattedDate(new Date(connection.createdAt))}
                </Text>
              </Stack>
              {connection.revokedAt ? (
                <Badge color="gray">{t("mcpOAuth.revoked")}</Badge>
              ) : (
                <Button
                  variant="light"
                  color="red"
                  loading={
                    disconnect.isPending &&
                    disconnect.variables === connection.id
                  }
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(connection.id)}
                >
                  {t("mcpOAuth.disconnect")}
                </Button>
              )}
            </Group>
          </Paper>
        ))
      )}
      {disconnect.isError && <Alert color="red">{t("mcpOAuth.failed")}</Alert>}
    </Stack>
  );
}
