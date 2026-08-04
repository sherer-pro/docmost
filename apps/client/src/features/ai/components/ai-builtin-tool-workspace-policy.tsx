import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { AiBuiltinToolCapability } from "@docmost/api-contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAiBuiltinToolWorkspacePolicyQuery,
  useUpdateAiBuiltinToolWorkspacePolicyMutation,
} from "@/features/ai/queries/ai-tool-policy-query.ts";
import { AiToolCapabilityList } from "./ai-tool-capability-list.tsx";

export function AiBuiltinToolWorkspacePolicy() {
  const { t } = useTranslation();
  const query = useAiBuiltinToolWorkspacePolicyQuery();
  const mutation = useUpdateAiBuiltinToolWorkspacePolicyMutation();
  const [enabled, setEnabled] = useState(true);
  const [allowed, setAllowed] = useState<AiBuiltinToolCapability[]>([]);

  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.enabled);
    setAllowed(query.data.allowedCapabilities);
  }, [query.data]);

  if (query.isLoading) {
    return <Loader size="sm" />;
  }
  if (!query.data) {
    return <Alert color="red">{t("ai.toolPolicy.loadFailed")}</Alert>;
  }

  const maximum = new Set(query.data.maximumCapabilities);
  const configuredButDisabled = allowed.filter(
    (capability) => !maximum.has(capability),
  );

  const save = async () => {
    await mutation.mutateAsync({ enabled, allowedCapabilities: allowed });
    notifications.show({
      color: "green",
      message: t("ai.toolPolicy.saved"),
    });
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>{t("ai.toolPolicy.workspaceTitle")}</Text>
          <Text size="sm" c="dimmed">
            {t("ai.toolPolicy.workspaceDescription")}
          </Text>
        </div>
        <Switch
          label={t("ai.toolPolicy.enabled")}
          description={t("ai.toolPolicy.enabledDescription")}
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        <AiToolCapabilityList
          catalog={query.data.catalog}
          allowed={allowed}
          available={query.data.maximumCapabilities}
          onChange={setAllowed}
          disabled={!enabled || mutation.isPending}
        />
        <Text size="xs" c="dimmed">
          {t("ai.toolPolicy.effectiveSummary", {
            active: query.data.effectiveCapabilities.length,
            maximum: query.data.maximumCapabilities.length,
          })}
        </Text>
        {configuredButDisabled.length > 0 && (
          <Alert color="yellow">
            {t("ai.toolPolicy.deploymentDisabled", {
              count: configuredButDisabled.length,
            })}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button loading={mutation.isPending} onClick={() => void save()}>
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
