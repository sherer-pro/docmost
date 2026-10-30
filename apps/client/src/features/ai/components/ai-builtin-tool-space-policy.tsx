import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  SegmentedControl,
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
  const [readOnly, setReadOnly] = useState(false);
  const [knowledgeOnly, setKnowledgeOnly] = useState(false);
  const [allowed, setAllowed] = useState<AiBuiltinToolCapability[]>([]);

  useEffect(() => {
    if (!query.data) return;
    setInherited(query.data.inherited);
    setReadOnly(Boolean(query.data.readOnly));
    setKnowledgeOnly(Boolean(query.data.knowledgeOnly));
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
      readOnly,
      knowledgeOnly,
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
          disabled={readOnly || inherited || mutation.isPending}
        />
        <Text size="sm" fw={500}>
          {t("ai.toolPolicy.preset")}
        </Text>
        <SegmentedControl
          fullWidth
          styles={{ label: { whiteSpace: "normal" } }}
          aria-label={t("ai.toolPolicy.preset")}
          value={
            readOnly || query.data.workspaceReadOnly ? "answers" : "approval"
          }
          onChange={(value) => setReadOnly(value === "answers")}
          data={[
            { value: "answers", label: t("ai.toolPolicy.answersOnly") },
            { value: "approval", label: t("ai.toolPolicy.confirmChanges") },
          ]}
          disabled={query.data.workspaceReadOnly || mutation.isPending}
        />
        <Text size="xs" c="dimmed">
          {t("ai.toolPolicy.readOnlyDescription")}
        </Text>
        <Switch
          label={t("ai.toolPolicy.knowledgeOnly")}
          description={t("ai.toolPolicy.knowledgeOnlyDescription")}
          checked={knowledgeOnly}
          disabled={query.data.workspaceKnowledgeOnly || mutation.isPending}
          onChange={(event) => setKnowledgeOnly(event.currentTarget.checked)}
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
