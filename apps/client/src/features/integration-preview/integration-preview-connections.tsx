import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  PasswordInput,
  Skeleton,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import {
  INTEGRATION_PREVIEW_PROVIDERS,
  type IntegrationPreviewProvider,
} from "@docmost/api-contract";
import useUserRole from "@/hooks/use-user-role";
import {
  getIntegrationPreviewConnections,
  getIntegrationPreviewSettings,
  removeIntegrationPreviewConnection,
  saveIntegrationPreviewConnection,
  updateIntegrationPreviewSettings,
} from "./integration-preview-service";

const providerName = { github: "GitHub", gitlab: "GitLab", figma: "Figma" };

export default function IntegrationPreviewConnections() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const current = useAtomValue(currentUserAtom);
  const viewer = `${current?.workspace?.id}:${current?.user?.id}`;
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["integration-previews", "settings", viewer],
    queryFn: getIntegrationPreviewSettings,
  });
  const connections = useQuery({
    queryKey: ["integration-previews", "connections", viewer],
    queryFn: getIntegrationPreviewConnections,
  });
  const change = useMutation({
    mutationFn: updateIntegrationPreviewSettings,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["integration-previews"] }),
  });
  if (settings.isPending || connections.isPending)
    return <Skeleton height={180} />;
  if (settings.isError || connections.isError)
    return <Alert color="red">{t("integrationPreviews.failed")}</Alert>;
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t("integrationPreviews.privacy")}
      </Text>
      {isAdmin && (
        <Paper withBorder p="md">
          <Stack gap="xs">
            <Switch
              label={t("integrationPreviews.enabled")}
              description={t("integrationPreviews.enableDescription")}
              checked={settings.data.enabled}
              disabled={change.isPending}
              onChange={(event) => change.mutate(event.currentTarget.checked)}
            />
            {!settings.data.availableProviders.length && (
              <Text size="sm" c="dimmed">
                {t("integrationPreviews.noApprovedProviders")}
              </Text>
            )}
            {change.isError && (
              <Alert color="red">{t("integrationPreviews.failed")}</Alert>
            )}
          </Stack>
        </Paper>
      )}
      {!settings.data.enabled && (
        <Alert>{t("integrationPreviews.disabled")}</Alert>
      )}
      <Text size="sm">{t("integrationPreviews.publicGithub")}</Text>
      {INTEGRATION_PREVIEW_PROVIDERS.map((provider) => (
        <ProviderConnection
          key={`${viewer}:${provider}`}
          provider={provider}
          configured={connections.data.some(
            (item) => item.provider === provider,
          )}
          enabled={
            settings.data.enabled &&
            settings.data.availableProviders.includes(provider)
          }
        />
      ))}
    </Stack>
  );
}

function ProviderConnection({
  provider,
  configured,
  enabled,
}: {
  provider: IntegrationPreviewProvider;
  configured: boolean;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [credential, setCredential] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: saveIntegrationPreviewConnection,
    gcTime: 0,
    onError: () => setSaveFailed(true),
    onSuccess: () => {
      setCredential("");
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["integration-previews"] });
    },
    onSettled: () => queueMicrotask(() => save.reset()),
  });
  const remove = useMutation({
    mutationFn: removeIntegrationPreviewConnection,
    onSuccess: () => {
      setCredential("");
      setSaved(false);
      void client.invalidateQueries({ queryKey: ["integration-previews"] });
    },
  });
  const [saveFailed, setSaveFailed] = useState(false);
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={500}>{providerName[provider]}</Text>
          {configured && (
            <Badge variant="light">{t("integrationPreviews.configured")}</Badge>
          )}
        </Group>
        <PasswordInput
          label={`${providerName[provider]} — ${t("integrationPreviews.token")}`}
          description={t("integrationPreviews.tokenHint")}
          value={credential}
          autoComplete="off"
          onChange={(event) => {
            setCredential(event.currentTarget.value);
            setSaved(false);
          }}
          disabled={!enabled || save.isPending}
        />
        <Group>
          <Button
            disabled={
              !enabled ||
              !credential.trim() ||
              save.isPending ||
              remove.isPending
            }
            loading={save.isPending}
            onClick={() => {
              setSaveFailed(false);
              save.mutate({ provider, credential });
            }}
          >
            {t("integrationPreviews.save")}
          </Button>
          {configured && (
            <Button
              color="red"
              variant="light"
              loading={remove.isPending}
              disabled={save.isPending || remove.isPending}
              onClick={() => remove.mutate(provider)}
            >
              {t("integrationPreviews.disconnect")}
            </Button>
          )}
        </Group>
        {saved && (
          <Text size="sm" c="dimmed">
            {t("integrationPreviews.saved")}
          </Text>
        )}
        {(saveFailed || remove.isError) && (
          <Alert color="red">{t("integrationPreviews.failed")}</Alert>
        )}
      </Stack>
    </Paper>
  );
}
