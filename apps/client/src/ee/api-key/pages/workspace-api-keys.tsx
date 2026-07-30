import React, { useState } from "react";
import { Button, Group, Space, Text } from "@mantine/core";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import { ApiKeyTable } from "@/ee/api-key/components/api-key-table";
import { CreateApiKeyModal } from "@/ee/api-key/components/create-api-key-modal";
import { ApiKeyCreatedModal } from "@/ee/api-key/components/api-key-created-modal";
import { UpdateApiKeyModal } from "@/ee/api-key/components/update-api-key-modal";
import { RevokeApiKeyModal } from "@/ee/api-key/components/revoke-api-key-modal";
import Paginate from "@/components/common/paginate";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useGetApiKeysQuery } from "@/ee/api-key/queries/api-key-query.ts";
import { IApiKey, type McpClientPreset } from "@/ee/api-key";
import useUserRole from "@/hooks/use-user-role.tsx";

export default function WorkspaceApiKeys() {
  const { t } = useTranslation();
  const { cursor, goNext, goPrev } = useCursorPaginate();
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<IApiKey | null>(null);
  const [createdClient, setCreatedClient] =
    useState<McpClientPreset>("universal");
  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [revokeModalOpened, setRevokeModalOpened] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState<IApiKey | null>(null);
  const { data, isLoading } = useGetApiKeysQuery({ cursor, adminView: true });
  const { isAdmin } = useUserRole();

  if (!isAdmin) {
    return null;
  }

  const handleCreateSuccess = (response: IApiKey, client: McpClientPreset) => {
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

  return (
    <>
      <Helmet>
        <title>
          {t("apiKeys.workspaceTitle")} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={t("apiKeys.workspaceTitle")} />

      <Text size="md" c="dimmed" mb="md">
        {t("apiKeys.workspaceDescription")}
      </Text>

      <Group justify="flex-end" mb="md">
        <Button onClick={() => setCreateModalOpened(true)}>
          {t("Create API Key")}
        </Button>
      </Group>

      <ApiKeyTable
        apiKeys={data?.items || []}
        isLoading={isLoading}
        showUserColumn
        showSpaceColumn
        onUpdate={handleUpdate}
        onRevoke={handleRevoke}
      />

      <Space h="md" />

      {data?.items.length > 0 && (
        <Paginate
          hasPrevPage={data?.meta?.hasPrevPage}
          hasNextPage={data?.meta?.hasNextPage}
          onNext={() => goNext(data?.meta?.nextCursor)}
          onPrev={goPrev}
        />
      )}

      <CreateApiKeyModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        onSuccess={handleCreateSuccess}
        allowMcp
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
