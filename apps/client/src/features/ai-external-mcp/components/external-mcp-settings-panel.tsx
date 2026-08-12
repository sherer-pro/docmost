import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  TagsInput,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconPlugConnectedX,
  IconPlus,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import ExternalMcpServerTable from "./external-mcp-server-table.tsx";
import ExternalMcpServerFormModal from "./external-mcp-server-form-modal.tsx";
import ExternalMcpServerDetail from "./external-mcp-server-detail.tsx";
import {
  useAiExternalMcpServersQuery,
  useAiExternalMcpSettingsQuery,
  useDeleteAiExternalMcpServerMutation,
  useUpdateAiExternalMcpServerMutation,
  useUpdateAiExternalMcpSettingsMutation,
} from "@/features/ai-external-mcp/queries/ai-external-mcp-query.ts";
import type { AiExternalMcpServerListItem } from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

export default function ExternalMcpSettingsPanel() {
  const { t, i18n } = useTranslation();
  const settingsQuery = useAiExternalMcpSettingsQuery();
  const serversQuery = useAiExternalMcpServersQuery();
  const updateSettings = useUpdateAiExternalMcpSettingsMutation();
  const updateServer = useUpdateAiExternalMcpServerMutation();
  const deleteServer = useDeleteAiExternalMcpServerMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [detailServerId, setDetailServerId] = useState<string | null>(null);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [workspaceOrigins, setWorkspaceOrigins] = useState<string[]>([]);

  const settings = settingsQuery.data;
  const servers = serversQuery.data ?? [];
  const deploymentEnabled = settings?.deploymentEnabled ?? false;
  const workspaceEnabled = settings?.enabled ?? false;

  const allowedOrigins = useMemo(
    () => settings?.allowedOrigins ?? [],
    [settings?.allowedOrigins],
  );
  const deploymentOriginsConfigured =
    (settings?.deploymentAllowedOrigins.length ?? 0) > 0;
  const workspaceOriginsConfigured = allowedOrigins.length > 0;
  const canEditWorkspaceOrigins =
    deploymentEnabled &&
    (deploymentOriginsConfigured || workspaceOriginsConfigured);
  const canEnableWorkspace = deploymentEnabled && deploymentOriginsConfigured;
  const canAddServer = canEnableWorkspace && workspaceOriginsConfigured;

  const workspaceSetupDisabledReason = !deploymentEnabled
    ? t("ai.externalTools.deploymentDisabledBody")
    : !deploymentOriginsConfigured
      ? t("ai.externalTools.allowedOriginsEmpty")
      : t("ai.externalTools.workspaceAllowedOriginsDescription");

  useEffect(() => {
    setWorkspaceOrigins(settings?.allowedOrigins ?? []);
  }, [settings?.allowedOrigins]);

  const saveWorkspaceOrigins = async () => {
    try {
      await updateSettings.mutateAsync({ allowedOrigins: workspaceOrigins });
      notifications.show({
        color: "green",
        message: t("ai.externalTools.allowedOriginsSaved"),
      });
    } catch (error) {
      notifications.show({
        color: "red",
        message:
          (error as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ?? t("ai.externalTools.saveFailed"),
      });
    }
  };

  const toggleEnabled = async (server: AiExternalMcpServerListItem) => {
    setBusyServerId(server.id);
    try {
      await updateServer.mutateAsync({
        serverId: server.id,
        data: { enabled: !server.enabled },
      });
    } catch (error) {
      notifications.show({
        color: "red",
        message:
          (error as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ?? t("ai.externalTools.saveFailed"),
      });
    } finally {
      setBusyServerId(null);
    }
  };

  if (settingsQuery.isLoading) {
    return (
      <Group justify="center" py="xl" role="status">
        <Loader size="sm" />
      </Group>
    );
  }

  if (settingsQuery.isError || !settings) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
        {resolveAiErrorMessage(t, i18n, null)}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2} size="h3">
          {t("ai.externalTools.title")}
        </Title>
        <Text size="sm" c="dimmed" maw={760}>
          {t("ai.externalTools.description")}
        </Text>
      </div>

      {/* The kill switch hides nothing: an administrator needs to see what is
          configured and why it is inert. */}
      {!deploymentEnabled && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title={t("ai.externalTools.deploymentDisabledTitle")}
        >
          {t("ai.externalTools.deploymentDisabledBody")}
        </Alert>
      )}

      {deploymentEnabled && !deploymentOriginsConfigured && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title={t("ai.externalTools.deploymentAllowedOrigins")}
        >
          {t("ai.externalTools.allowedOriginsEmpty")}
        </Alert>
      )}

      <Paper withBorder radius="md" p="md">
        <Stack gap="sm">
          <Tooltip
            label={workspaceSetupDisabledReason}
            disabled={canEnableWorkspace || workspaceEnabled}
          >
            <Switch
              checked={workspaceEnabled}
              onChange={(event) =>
                updateSettings.mutate({ enabled: event.currentTarget.checked })
              }
              label={t("ai.externalTools.masterSwitch")}
              description={t("ai.externalTools.masterSwitchDescription")}
              disabled={
                !deploymentEnabled ||
                updateSettings.isPending ||
                (!workspaceEnabled && !deploymentOriginsConfigured)
              }
            />
          </Tooltip>

          <div>
            <Text size="sm" fw={500}>
              {t("ai.externalTools.deploymentAllowedOrigins")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("ai.externalTools.allowedOriginsDescription")}
            </Text>
            <Text size="sm" ff="monospace" mt={4}>
              {settings.deploymentAllowedOrigins.length > 0
                ? settings.deploymentAllowedOrigins.join(", ")
                : t("ai.externalTools.allowedOriginsEmpty")}
            </Text>
          </div>

          <Stack gap={6}>
            <TagsInput
              label={t("ai.externalTools.allowedOrigins")}
              description={t(
                "ai.externalTools.workspaceAllowedOriginsDescription",
              )}
              value={workspaceOrigins}
              onChange={setWorkspaceOrigins}
              placeholder="https://mcp.example.com"
              splitChars={[","]}
              disabled={!canEditWorkspaceOrigins || updateSettings.isPending}
            />
            <Group justify="flex-end">
              <Button
                size="xs"
                variant="light"
                onClick={() => void saveWorkspaceOrigins()}
                loading={updateSettings.isPending}
                disabled={!canEditWorkspaceOrigins || updateSettings.isPending}
              >
                {t("ai.externalTools.saveAllowedOrigins")}
              </Button>
            </Group>
          </Stack>

          <Text size="xs" c="dimmed">
            {t("ai.externalTools.gateDescription")}
          </Text>
        </Stack>
      </Paper>

      <Group justify="space-between" align="center">
        <Text fw={600}>
          {t("ai.externalTools.serverCount", { count: servers.length })}
        </Text>
        <Tooltip label={workspaceSetupDisabledReason} disabled={canAddServer}>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setCreateOpen(true)}
            disabled={!canAddServer}
          >
            {t("ai.externalTools.addServer")}
          </Button>
        </Tooltip>
      </Group>

      {serversQuery.isError ? (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
        >
          {resolveAiErrorMessage(t, i18n, null)}
        </Alert>
      ) : serversQuery.isLoading ? (
        <Group justify="center" py="xl" role="status">
          <Loader size="sm" />
        </Group>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={IconPlugConnectedX}
          title={t("ai.externalTools.emptyTitle")}
          description={t("ai.externalTools.emptyDescription")}
        />
      ) : (
        <ExternalMcpServerTable
          servers={servers}
          deploymentEnabled={deploymentEnabled}
          workspaceEnabled={workspaceEnabled}
          onEdit={setDetailServerId}
          onDelete={(serverId) => deleteServer.mutate(serverId)}
          onToggleEnabled={(server) => void toggleEnabled(server)}
          busyServerId={busyServerId}
        />
      )}

      {createOpen && (
        <ExternalMcpServerFormModal
          opened
          onClose={() => setCreateOpen(false)}
          server={null}
          allowedOrigins={allowedOrigins}
          disabled={!canAddServer}
        />
      )}

      {detailServerId && (
        <ExternalMcpServerDetail
          serverId={detailServerId}
          onClose={() => setDetailServerId(null)}
          deploymentEnabled={deploymentEnabled}
          workspaceEnabled={workspaceEnabled}
          allowedOrigins={allowedOrigins}
        />
      )}
    </Stack>
  );
}
