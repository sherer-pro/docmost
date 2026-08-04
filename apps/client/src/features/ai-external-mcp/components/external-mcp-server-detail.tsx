import { useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import ExternalMcpConnectionActions from "./external-mcp-connection-actions.tsx";
import ExternalMcpServerFormModal from "./external-mcp-server-form-modal.tsx";
import ExternalMcpToolApprovalList, {
  type ToolApprovalDraft,
} from "./external-mcp-tool-approval-list.tsx";
import {
  useAiExternalMcpServerQuery,
  useDiscoverAiExternalMcpServerMutation,
  useTestAiExternalMcpServerMutation,
  useUpdateAiExternalMcpServerMutation,
} from "@/features/ai-external-mcp/queries/ai-external-mcp-query.ts";
import type {
  AiExternalMcpDiscoverResult,
  AiExternalMcpTestResult,
} from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

type Props = {
  serverId: string;
  onClose: () => void;
  deploymentEnabled: boolean;
  workspaceEnabled: boolean;
  allowedOrigins: string[];
};

export default function ExternalMcpServerDetail({
  serverId,
  onClose,
  deploymentEnabled,
  allowedOrigins,
}: Props) {
  const { t } = useTranslation();
  const serverQuery = useAiExternalMcpServerQuery(serverId);
  const testMutation = useTestAiExternalMcpServerMutation();
  const discoverMutation = useDiscoverAiExternalMcpServerMutation();
  const updateMutation = useUpdateAiExternalMcpServerMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ToolApprovalDraft>>({});
  const [testResult, setTestResult] = useState<AiExternalMcpTestResult | null>(
    null,
  );
  const [discoverResult, setDiscoverResult] =
    useState<AiExternalMcpDiscoverResult | null>(null);

  const server = serverQuery.data;
  const tools = server?.discovery?.tools ?? [];

  const saveApprovals = async () => {
    if (!server) {
      return;
    }
    const payload = tools.map((tool) => {
      const draft = drafts[tool.remoteName];
      const approved = draft?.approved ?? tool.approved;
      const description =
        draft?.description ??
        server.approvedTools.find(
          (candidate) => candidate.remoteName === tool.remoteName,
        )?.description ??
        "";
      return { remoteName: tool.remoteName, approved, description };
    });

    const missing = payload.find(
      (item) => item.approved && item.description.trim().length === 0,
    );
    if (missing) {
      notifications.show({
        color: "red",
        message: t("ai.externalTools.modelDescriptionRequired"),
      });
      return;
    }

    try {
      await updateMutation.mutateAsync({ serverId, data: { tools: payload } });
      setDrafts({});
      notifications.show({
        color: "green",
        message: t("ai.externalTools.enableServerReminder"),
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

  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size="xl"
      title={server?.name ?? t("ai.externalTools.title")}
    >
      {serverQuery.isLoading || !server ? (
        <Group justify="center" py="xl" role="status">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack gap="md">
          <Stack gap={4}>
            <Text size="sm" c="dimmed" ff="monospace">
              {server.url}
            </Text>
            <Text size="xs" c="dimmed">
              {t("ai.externalTools.namespace")}: {server.namespace}
            </Text>
          </Stack>

          <Group gap="xs">
            <Button
              variant="default"
              size="compact-sm"
              onClick={() => setEditOpen(true)}
            >
              {t("Edit")}
            </Button>
          </Group>

          <Divider />

          <ExternalMcpConnectionActions
            onTest={() =>
              testMutation.mutate(serverId, { onSuccess: setTestResult })
            }
            onDiscover={() =>
              discoverMutation.mutate(serverId, {
                onSuccess: (result) => {
                  setDiscoverResult(result);
                  setDrafts({});
                },
              })
            }
            testing={testMutation.isPending}
            discovering={discoverMutation.isPending}
            testResult={testResult}
            discoverResult={discoverResult}
            // Testing a connection while the feature is off is a safe and
            // useful setup step, so only the deployment switch blocks it.
            disabled={!deploymentEnabled}
          />

          <Divider />

          {tools.length === 0 ? (
            <Alert color="blue" variant="light">
              {t("ai.externalTools.discoverBeforeApprove")}
            </Alert>
          ) : (
            <>
              <Alert color="green" variant="light">
                {t("ai.externalTools.readOnlyNotice")}
              </Alert>

              <ExternalMcpToolApprovalList
                tools={tools}
                approved={server.approvedTools}
                drafts={drafts}
                onChange={(remoteName, draft) =>
                  setDrafts((current) => ({ ...current, [remoteName]: draft }))
                }
                disabled={updateMutation.isPending}
              />

              <Group justify="flex-end">
                <Button
                  onClick={() => void saveApprovals()}
                  loading={updateMutation.isPending}
                >
                  {t("ai.externalTools.saveApprovals")}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      )}

      {editOpen && server && (
        <ExternalMcpServerFormModal
          opened
          onClose={() => setEditOpen(false)}
          server={server}
          allowedOrigins={allowedOrigins}
          disabled={!deploymentEnabled}
        />
      )}
    </Drawer>
  );
}
