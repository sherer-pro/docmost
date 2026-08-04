import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { IconCalendar, IconInfoCircle } from "@tabler/icons-react";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert";
import { useCreateApiKeyMutation } from "@/features/api-key/queries/api-key-query";
import { IApiKey, type McpClientPreset } from "@/features/api-key";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import type { AiBuiltinToolCapability } from "@docmost/api-contract";
import { useAiBuiltinToolSpacePolicyQuery } from "@/features/ai/queries/ai-tool-policy-query.ts";
import { AiToolCapabilityList } from "@/features/ai/components/ai-tool-capability-list.tsx";
import {
  getAvailableMcpCapabilities,
  getMcpCapabilityPolicyState,
  getUnavailableMcpCapabilities,
  initializeMcpCapabilitySelection,
} from "@/features/api-key/utils/mcp-capability-policy.ts";

const DateInput = lazy(() =>
  import("@mantine/dates").then((module) => ({
    default: module.DateInput,
  })),
);

interface CreateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: (response: IApiKey, client: McpClientPreset) => void;
  keyType: "rag" | "mcp";
}

type FormValues = {
  name: string;
  spaceId: string;
  expiresAt: string | Date | null;
};

export function CreateApiKeyModal({
  opened,
  onClose,
  onSuccess,
  keyType,
}: CreateApiKeyModalProps) {
  useModalBackgroundInert(opened);
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState(0);
  const [expirationOption, setExpirationOption] = useState("365");
  const [client, setClient] = useState<McpClientPreset>("codex");
  const [allowedCapabilities, setAllowedCapabilities] = useState<
    AiBuiltinToolCapability[]
  >([]);
  const selectionsBySpace = useRef(
    new Map<string, AiBuiltinToolCapability[]>(),
  );
  const createApiKeyMutation = useCreateApiKeyMutation();
  const { data: spacesData, isLoading: isSpacesLoading } = useGetSpacesQuery({
    limit: 100,
  });
  const form = useForm<FormValues>({
    initialValues: {
      name: "",
      spaceId: "",
      expiresAt: null,
    },
    validate: {
      name: (value) =>
        value.trim().length > 0 ? null : t("apiKeys.validation.nameRequired"),
      spaceId: (value) =>
        value ? null : t("apiKeys.validation.spaceRequired"),
      expiresAt: (value) => {
        if (expirationOption !== "custom") return null;
        if (!value) return t("apiKeys.validation.expirationRequired");
        const date = new Date(value);
        return date.getTime() > Date.now()
          ? null
          : t("apiKeys.validation.expirationFuture");
      },
    },
  });
  const toolPolicy = useAiBuiltinToolSpacePolicyQuery(
    keyType === "mcp" ? form.values.spaceId : undefined,
  );

  useEffect(() => {
    if (opened && !form.values.spaceId && spacesData?.items?.length) {
      form.setFieldValue("spaceId", spacesData.items[0].id);
    }
  }, [opened, spacesData?.items, form.values.spaceId]);

  useEffect(() => {
    if (
      !opened ||
      keyType !== "mcp" ||
      !toolPolicy.data ||
      toolPolicy.data.spaceId !== form.values.spaceId
    ) {
      return;
    }
    setAllowedCapabilities(
      initializeMcpCapabilitySelection(
        selectionsBySpace.current,
        form.values.spaceId,
        getAvailableMcpCapabilities(toolPolicy.data),
      ),
    );
  }, [opened, keyType, form.values.spaceId, toolPolicy.data]);

  const setCapabilities = (capabilities: AiBuiltinToolCapability[]) => {
    setAllowedCapabilities(capabilities);
    if (form.values.spaceId) {
      selectionsBySpace.current.set(form.values.spaceId, [...capabilities]);
    }
  };
  const selectedPolicy =
    toolPolicy.data?.spaceId === form.values.spaceId
      ? toolPolicy.data
      : undefined;
  const policyState = getMcpCapabilityPolicyState({
    policy: selectedPolicy,
    loading: toolPolicy.isLoading || toolPolicy.isFetching,
    error: toolPolicy.isError,
  });
  const unavailableCapabilities = getUnavailableMcpCapabilities(
    allowedCapabilities,
    selectedPolicy,
  );

  const spaceOptions =
    spacesData?.items?.map((space) => ({
      value: space.id,
      label: space.name || space.slug,
    })) ?? [];
  const selectedSpace = spacesData?.items?.find(
    (space) => space.id === form.values.spaceId,
  );

  const expirationDate = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
  };
  const expirationOptions = [30, 60, 90, 365].map((days) => ({
    value: String(days),
    label: t("apiKeys.expirationOption", {
      days,
      date: new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
      }).format(expirationDate(days)),
    }),
  }));
  expirationOptions.push({
    value: "custom",
    label: t("apiKeys.customExpiration"),
  });

  const getExpirationDate = () => {
    if (expirationOption === "custom") {
      return form.values.expiresAt
        ? new Date(form.values.expiresAt).toISOString()
        : undefined;
    }
    return expirationDate(Number(expirationOption)).toISOString();
  };

  const next = () => {
    if (active === 0 && form.validateField("spaceId").hasError) return;
    if (active === 0 && keyType === "mcp") {
      if (
        policyState !== "ready" ||
        allowedCapabilities.length === 0 ||
        unavailableCapabilities.length > 0
      ) {
        return;
      }
    }
    if (
      active === 1 &&
      (form.validateField("name").hasError ||
        form.validateField("expiresAt").hasError)
    ) {
      return;
    }
    setActive((value) => Math.min(value + 1, 2));
  };

  const reset = () => {
    form.reset();
    setActive(0);
    setClient("codex");
    setExpirationOption("365");
    setAllowedCapabilities([]);
    selectionsBySpace.current.clear();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const create = async () => {
    if (form.validate().hasErrors) return;
    const createdKey = await createApiKeyMutation.mutateAsync({
      name: form.values.name.trim(),
      spaceId: form.values.spaceId,
      keyType,
      expiresAt: getExpirationDate(),
      ...(keyType === "mcp" ? { allowedCapabilities } : {}),
    });
    onSuccess(createdKey, keyType === "mcp" ? client : "universal");
    reset();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("apiKeys.createTitle")}
      size="lg"
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <Stepper active={active} size="sm" mb="xl" allowNextStepsSelect={false}>
        <Stepper.Step label={t("apiKeys.steps.space")} />
        <Stepper.Step label={t("apiKeys.steps.details")} />
        <Stepper.Step
          label={
            keyType === "mcp"
              ? t("apiKeys.steps.client")
              : t("apiKeys.reviewTitle")
          }
        />
      </Stepper>

      <Stack gap="md" mih={250}>
        {active === 0 && (
          <>
            <Select
              label={t("Space")}
              description={t("apiKeys.spaceDescription")}
              placeholder={t("Select a space")}
              data={spaceOptions}
              searchable
              allowDeselect={false}
              required
              disabled={isSpacesLoading || spaceOptions.length === 0}
              {...form.getInputProps("spaceId")}
            />
            <Alert icon={<IconInfoCircle size={18} />} color="blue">
              {keyType === "mcp"
                ? t("apiKeys.mcpDifference")
                : t("apiKeys.ragDifference")}
            </Alert>
            {keyType === "mcp" && policyState === "loading" && (
              <Group gap="xs">
                <Loader size="sm" />
                <Text size="sm">{t("apiKeys.capabilitiesLoading")}</Text>
              </Group>
            )}
            {keyType === "mcp" && policyState === "error" && (
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
            {keyType === "mcp" && policyState === "empty" && (
              <Alert color="yellow">{t("apiKeys.noCapabilities")}</Alert>
            )}
            {keyType === "mcp" && policyState === "ready" && selectedPolicy && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  {t("apiKeys.capabilities")}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("apiKeys.capabilitiesDescription")}
                </Text>
                <AiToolCapabilityList
                  catalog={selectedPolicy.catalog}
                  available={getAvailableMcpCapabilities(selectedPolicy)}
                  exposure="mcp"
                  allowed={allowedCapabilities}
                  onChange={setCapabilities}
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
                        setCapabilities(
                          allowedCapabilities.filter(
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
          </>
        )}

        {active === 1 && (
          <>
            <TextInput
              label={t("Name")}
              description={t("apiKeys.nameDescription")}
              placeholder={t("Enter a descriptive name")}
              data-autofocus
              required
              {...form.getInputProps("name")}
            />
            <Select
              label={t("Expiration")}
              description={t("apiKeys.expirationDescription")}
              data={expirationOptions}
              value={expirationOption}
              onChange={(value) => setExpirationOption(value || "365")}
              leftSection={<IconCalendar size={16} />}
              allowDeselect={false}
            />
            {expirationOption === "custom" && (
              <Suspense fallback={null}>
                <DateInput
                  label={t("apiKeys.customExpiration")}
                  placeholder={t("Select expiration date")}
                  minDate={expirationDate(1)}
                  {...form.getInputProps("expiresAt")}
                />
              </Suspense>
            )}
          </>
        )}

        {active === 2 && (
          <>
            {keyType === "mcp" && (
              <Select
                label={t("apiKeys.client")}
                description={t("apiKeys.clientDescription")}
                value={client}
                onChange={(value) =>
                  setClient((value as McpClientPreset) || "codex")
                }
                allowDeselect={false}
                data={[
                  { value: "codex", label: "Codex" },
                  { value: "vscode", label: "VS Code" },
                  { value: "claude", label: "Claude Desktop" },
                  {
                    value: "universal",
                    label: t("apiKeys.universalClient"),
                  },
                ]}
              />
            )}
            <Alert color="gray" title={t("apiKeys.reviewTitle")}>
              <Text size="sm">
                {t("apiKeys.review", {
                  type: keyType === "mcp" ? t("MCP read-only") : t("RAG sync"),
                  space: selectedSpace?.name || selectedSpace?.slug,
                  name: form.values.name,
                })}
              </Text>
            </Alert>
          </>
        )}
      </Stack>

      <Group justify="space-between" mt="xl">
        <Button
          variant="default"
          onClick={active === 0 ? handleClose : () => setActive(active - 1)}
        >
          {active === 0 ? t("Cancel") : t("apiKeys.back")}
        </Button>
        {active < 2 ? (
          <Button
            onClick={next}
            disabled={
              spaceOptions.length === 0 ||
              (active === 0 && keyType === "mcp" && policyState !== "ready")
            }
          >
            {t("apiKeys.next")}
          </Button>
        ) : (
          <Button
            onClick={() => void create()}
            loading={createApiKeyMutation.isPending}
          >
            {t("Create")}
          </Button>
        )}
      </Group>
    </Modal>
  );
}
