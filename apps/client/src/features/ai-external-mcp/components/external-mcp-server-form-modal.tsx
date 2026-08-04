import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import ExternalMcpHeaderFields from "./external-mcp-header-fields.tsx";
import {
  buildAiExternalMcpHeaderPayload,
  validateAiExternalMcpHeaderRows,
  type AiExternalMcpHeaderDraft,
} from "@/features/ai-external-mcp/utils/ai-external-mcp-headers.ts";
import {
  useCreateAiExternalMcpServerMutation,
  useUpdateAiExternalMcpServerMutation,
} from "@/features/ai-external-mcp/queries/ai-external-mcp-query.ts";
import type { AiExternalMcpServer } from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
const URL_PATTERN = /^https?:\/\/.+/i;

type Props = {
  opened: boolean;
  onClose: () => void;
  /** Absent means create mode. */
  server: AiExternalMcpServer | null;
  allowedOrigins: string[];
  disabled?: boolean;
};

export default function ExternalMcpServerFormModal({
  opened,
  onClose,
  server,
  allowedOrigins,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const isEdit = server !== null;

  const [name, setName] = useState(server?.name ?? "");
  const [namespace, setNamespace] = useState(server?.namespace ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [headerDraft, setHeaderDraft] = useState<AiExternalMcpHeaderDraft>(
    isEdit ? { mode: "keep" } : { mode: "replace", rows: [] },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useCreateAiExternalMcpServerMutation();
  const updateMutation = useUpdateAiExternalMcpServerMutation();
  const pending = createMutation.isPending || updateMutation.isPending;

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    if (name.trim().length === 0) {
      nextErrors.name = t("ai.externalTools.nameRequired");
    }
    if (!isEdit && !NAMESPACE_PATTERN.test(namespace)) {
      nextErrors.namespace = t("ai.externalTools.namespaceInvalid");
    }
    if (!URL_PATTERN.test(url)) {
      nextErrors.url = t("ai.externalTools.urlInvalid");
    }

    if (headerDraft.mode === "replace") {
      const validation = validateAiExternalMcpHeaderRows(headerDraft.rows);
      if (validation.status === "invalid") {
        nextErrors.headers = t(
          `ai.externalTools.header${validation.reason
            .charAt(0)
            .toUpperCase()}${validation.reason.slice(1)}`,
        );
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const headerPayload = buildAiExternalMcpHeaderPayload(headerDraft);

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          serverId: server.id,
          data: { name: name.trim(), url, ...headerPayload },
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          namespace,
          url,
          ...(headerPayload.headers ? { headers: headerPayload.headers } : {}),
        });
      }
      onClose();
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
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        isEdit
          ? t("ai.externalTools.formEditTitle")
          : t("ai.externalTools.formCreateTitle")
      }
      size="lg"
    >
      <Stack gap="md">
        <TextInput
          label={t("ai.externalTools.name")}
          description={t("ai.externalTools.nameDescription")}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          error={errors.name}
          disabled={pending}
        />

        <TextInput
          label={t("ai.externalTools.namespace")}
          description={
            isEdit
              ? t("ai.externalTools.namespaceLocked")
              : t("ai.externalTools.namespaceDescription")
          }
          value={namespace}
          onChange={(event) => setNamespace(event.currentTarget.value)}
          error={errors.namespace}
          // Immutable after creation: the namespace is part of every tool name
          // the model has already been shown.
          disabled={isEdit || pending}
        />

        <TextInput
          label={t("ai.externalTools.url")}
          description={
            allowedOrigins.length > 0
              ? t("ai.externalTools.urlDescriptionWithOrigins", {
                  origins: allowedOrigins.join(", "),
                })
              : t("ai.externalTools.urlDescription")
          }
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          error={errors.url}
          disabled={pending}
        />

        <Text size="sm" c="dimmed">
          {t("ai.externalTools.transport")}:{" "}
          {t("ai.externalTools.transportStreamableHttp")}
        </Text>

        <ExternalMcpHeaderFields
          draft={headerDraft}
          onChange={setHeaderDraft}
          storedNames={server?.headerNames ?? []}
          allowKeep={isEdit}
          disabled={pending}
          error={errors.headers}
        />

        {!isEdit && (
          <Alert color="blue" variant="light">
            {t("ai.externalTools.createdDisabledNotice")}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={pending}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            loading={pending}
            disabled={disabled}
          >
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
