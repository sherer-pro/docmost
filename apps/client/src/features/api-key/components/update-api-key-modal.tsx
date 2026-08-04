import {
  Alert,
  Modal,
  TextInput,
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useUpdateApiKeyMutation } from "@/features/api-key/queries/api-key-query";
import { IApiKey } from "@/features/api-key";
import { useEffect } from "react";
import type { AiBuiltinToolCapability } from "@docmost/api-contract";
import { useState } from "react";
import { useAiBuiltinToolSpacePolicyQuery } from "@/features/ai/queries/ai-tool-policy-query.ts";
import { AiToolCapabilityList } from "@/features/ai/components/ai-tool-capability-list.tsx";
import {
  getAvailableMcpCapabilities,
  getMcpCapabilityPolicyState,
  getUnavailableMcpCapabilities,
} from "@/features/api-key/utils/mcp-capability-policy.ts";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
});
type FormValues = z.infer<typeof formSchema>;

interface UpdateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
  apiKey: IApiKey | null;
}

export function UpdateApiKeyModal({
  opened,
  onClose,
  apiKey,
}: UpdateApiKeyModalProps) {
  const { t } = useTranslation();
  const updateApiKeyMutation = useUpdateApiKeyMutation();
  const toolPolicy = useAiBuiltinToolSpacePolicyQuery(
    apiKey?.keyType === "mcp" ? apiKey.spaceId : undefined,
  );
  const [allowedCapabilities, setAllowedCapabilities] = useState<
    AiBuiltinToolCapability[]
  >([]);

  const form = useForm<FormValues>({
    validate: zodResolver(formSchema),
    initialValues: {
      name: "",
    },
  });

  useEffect(() => {
    if (opened && apiKey) {
      form.setValues({ name: apiKey.name });
      setAllowedCapabilities(apiKey.allowedCapabilities ?? []);
    }
  }, [opened, apiKey]);

  const policyState = getMcpCapabilityPolicyState({
    policy: toolPolicy.data,
    loading: toolPolicy.isLoading || toolPolicy.isFetching,
    error: toolPolicy.isError,
  });
  const unavailableCapabilities = getUnavailableMcpCapabilities(
    allowedCapabilities,
    toolPolicy.data,
  );

  const handleSubmit = async (data: { name?: string }) => {
    if (!apiKey) return;
    const apiKeyData = {
      apiKeyId: apiKey.id,
      name: data.name,
      ...(apiKey.keyType === "mcp" ? { allowedCapabilities } : {}),
    };

    if (
      apiKey.keyType === "mcp" &&
      (policyState !== "ready" ||
        allowedCapabilities.length === 0 ||
        unavailableCapabilities.length > 0)
    ) {
      return;
    }

    await updateApiKeyMutation.mutateAsync(apiKeyData);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Update API key")}
      size="md"
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <form onSubmit={form.onSubmit((values) => handleSubmit(values))}>
        <Stack gap="md">
          <TextInput
            label={t("Name")}
            placeholder={t("Enter a descriptive token name")}
            required
            {...form.getInputProps("name")}
          />

          {apiKey?.keyType === "mcp" && policyState === "loading" && (
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm">{t("apiKeys.capabilitiesLoading")}</Text>
            </Group>
          )}
          {apiKey?.keyType === "mcp" && policyState === "error" && (
            <Alert color="red" title={t("apiKeys.capabilitiesLoadFailed")}>
              <Button
                mt="xs"
                size="xs"
                variant="light"
                onClick={() => void toolPolicy.refetch()}
              >
                {t("ai.tryAgain")}
              </Button>
            </Alert>
          )}
          {apiKey?.keyType === "mcp" && policyState === "empty" && (
            <Alert color="yellow">{t("apiKeys.noCapabilities")}</Alert>
          )}
          {apiKey?.keyType === "mcp" &&
            policyState === "ready" &&
            toolPolicy.data && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                {t("apiKeys.capabilities")}
              </Text>
              <AiToolCapabilityList
                catalog={toolPolicy.data.catalog}
                available={getAvailableMcpCapabilities(toolPolicy.data)}
                exposure="mcp"
                allowed={allowedCapabilities}
                onChange={setAllowedCapabilities}
              />
              {unavailableCapabilities.length > 0 && (
                <Alert color="yellow" title={t("apiKeys.capabilitiesRevoked")}>
                  <Text size="xs">
                    {unavailableCapabilities.join(", ")}
                  </Text>
                  <Button
                    mt="xs"
                    size="xs"
                    variant="light"
                    onClick={() =>
                      setAllowedCapabilities((current) =>
                        current.filter(
                          (capability) =>
                            !unavailableCapabilities.includes(capability),
                        ),
                      )
                    }
                  >
                    {t("apiKeys.removeUnavailableCapabilities")}
                  </Button>
                </Alert>
              )}
              {allowedCapabilities.length === 0 && (
                <Text size="xs" c="red">
                  {t("apiKeys.validation.capabilityRequired")}
                </Text>
              )}
            </Stack>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              loading={updateApiKeyMutation.isPending}
              disabled={
                apiKey?.keyType === "mcp" &&
                (policyState !== "ready" ||
                  allowedCapabilities.length === 0 ||
                  unavailableCapabilities.length > 0)
              }
            >
              {t("Update")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
