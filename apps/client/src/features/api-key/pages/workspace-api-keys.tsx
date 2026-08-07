import { useState } from "react";
import { Alert, Button, Group, Loader, Space, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconKeyOff, IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { ApiKeyTable } from "@/features/api-key/components/api-key-table";
import { CreateApiKeyModal } from "@/features/api-key/components/create-api-key-modal";
import { ApiKeyCreatedModal } from "@/features/api-key/components/api-key-created-modal";
import { UpdateApiKeyModal } from "@/features/api-key/components/update-api-key-modal";
import { RevokeApiKeyModal } from "@/features/api-key/components/revoke-api-key-modal";
import Paginate from "@/components/common/paginate";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useGetApiKeysQuery } from "@/features/api-key/queries/api-key-query.ts";
import {
  ICreatedApiKey,
  IApiKey,
  type ApiKeyType,
  type McpClientPreset,
} from "@/features/api-key";

interface WorkspaceApiKeysPanelProps {
  keyType: ApiKeyType;
}

export function WorkspaceApiKeysPanel({ keyType }: WorkspaceApiKeysPanelProps) {
  const { t } = useTranslation();
  const { cursor, goNext, goPrev } = useCursorPaginate();
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [createdApiKey, setCreatedApiKey] =
    useState<ICreatedApiKey | null>(null);
  const [createdClient, setCreatedClient] =
    useState<McpClientPreset>("universal");
  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [revokeModalOpened, setRevokeModalOpened] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState<IApiKey | null>(null);
  const keysQuery = useGetApiKeysQuery({
    cursor,
    adminView: true,
    keyType,
  });
  const description = t(
    keyType === "rag"
      ? "ai.integrations.ragDescription"
      : "ai.integrations.mcpDescription",
  );

  const handleCreateSuccess = (
    response: ICreatedApiKey,
    client: McpClientPreset,
  ) => {
    setCreatedApiKey(response);
    setCreatedClient(client);
  };

  const handleUpdate = (apiKey: IApiKey) => {
    setSelectedApiKey(apiKey);
    setUpdateModalOpened(true);
  };

  const handleRevoke = (apiKey: IApiKey) => {
    setSelectedApiKey(apiKey);
    setRevokeModalOpened(true);
  };

  const createButton = (
    <Button onClick={() => setCreateModalOpened(true)}>
      {t("Create API Key")}
    </Button>
  );

  return (
    <>
      <Text size="md" c="dimmed" mb="md">
        {description}
      </Text>

      {keysQuery.isLoading ? (
        <Group justify="center" py="xl" role="status">
          <Loader size="sm" />
        </Group>
      ) : keysQuery.isError ? (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title={t("Error")}
        >
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{t("Failed to load page. An error occurred.")}</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={15} />}
              onClick={() => void keysQuery.refetch()}
            >
              {t("ai.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : keysQuery.data?.items.length === 0 ? (
        <EmptyState
          icon={IconKeyOff}
          title={t("No API keys found")}
          description={description}
          action={createButton}
        />
      ) : (
        <>
          <Group justify="flex-end" mb="md">
            {createButton}
          </Group>
          <ApiKeyTable
            apiKeys={keysQuery.data?.items ?? []}
            showUserColumn
            showSpaceColumn
            showTypeColumn={false}
            onUpdate={handleUpdate}
            onRevoke={handleRevoke}
          />

          <Space h="md" />
          <Paginate
            hasPrevPage={keysQuery.data?.meta?.hasPrevPage}
            hasNextPage={keysQuery.data?.meta?.hasNextPage}
            onNext={() => goNext(keysQuery.data?.meta?.nextCursor)}
            onPrev={goPrev}
          />
        </>
      )}

      <CreateApiKeyModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        onSuccess={handleCreateSuccess}
        keyType={keyType}
      />

      <ApiKeyCreatedModal
        opened={!!createdApiKey}
        onClose={() => setCreatedApiKey(null)}
        apiKey={createdApiKey}
        preferredClient={createdClient}
      />

      <UpdateApiKeyModal
        opened={updateModalOpened}
        onClose={() => {
          setUpdateModalOpened(false);
          setSelectedApiKey(null);
        }}
        apiKey={selectedApiKey}
      />

      <RevokeApiKeyModal
        opened={revokeModalOpened}
        onClose={() => {
          setRevokeModalOpened(false);
          setSelectedApiKey(null);
        }}
        apiKey={selectedApiKey}
      />
    </>
  );
}
