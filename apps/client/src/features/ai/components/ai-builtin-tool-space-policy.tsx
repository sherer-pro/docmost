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
  useAiBuiltinToolSpacePolicyQuery,
  useUpdateAiBuiltinToolSpacePolicyMutation,
} from "@/features/ai/queries/ai-tool-policy-query.ts";
import { AiToolCapabilityList } from "./ai-tool-capability-list.tsx";

export function AiBuiltinToolSpacePolicy({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const query = useAiBuiltinToolSpacePolicyQuery(spaceId);
  const mutation = useUpdateAiBuiltinToolSpacePolicyMutation(spaceId);
  const [inherited, setInherited] = useState(true);
  const [allowed, setAllowed] = useState<AiBuiltinToolCapability[]>([]);

  useEffect(() => {
    if (!query.data) return;
    setInherited(query.data.inherited);
    setAllowed(
      query.data.allowedCapabilities ?? query.data.effectiveCapabilities,
    );
  }, [query.data]);

  if (query.isLoading) return <Loader size="sm" />;
  if (!query.data) {
    return <Alert color="red">{t("ai.toolPolicy.loadFailed")}</Alert>;
  }

  const save = async () => {
    await mutation.mutateAsync({
      allowedCapabilities: inherited ? null : allowed,
    });
    notifications.show({ color: "green", message: t("ai.toolPolicy.saved") });
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>{t("ai.toolPolicy.spaceTitle")}</Text>
          <Text size="sm" c="dimmed">
            {t("ai.toolPolicy.spaceDescription")}
          </Text>
        </div>
        <Switch
          label={t("ai.toolPolicy.inheritWorkspace")}
          checked={inherited}
          onChange={(event) => setInherited(event.currentTarget.checked)}
        />
        <AiToolCapabilityList
          catalog={query.data.catalog}
          allowed={inherited ? query.data.effectiveCapabilities : allowed}
          available={query.data.workspaceAllowedCapabilities}
          onChange={setAllowed}
          disabled={inherited || mutation.isPending}
        />
        <Group justify="flex-end">
          <Button loading={mutation.isPending} onClick={() => void save()}>
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
