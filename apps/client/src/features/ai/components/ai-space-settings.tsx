import {
  Accordion,
  Alert,
  Button,
  Group,
  NumberInput,
  PasswordInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  IconActivity,
  IconAdjustments,
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconCheck,
  IconGauge,
  IconKeyOff,
  IconMessageCircle,
  IconPlus,
  IconPlayerPlay,
  IconRobot,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import {
  AI_ASSISTANT_NAME_MAX_LENGTH,
  AI_RETRIEVAL_CONFIG_DEFAULTS,
  AI_SPACE_CONFIG_DEFAULTS,
} from "@docmost/api-contract";
import {
  useAiSpaceConfigQuery,
  useAiSpaceStatusQuery,
  useTestAiModelConfigMutation,
  useTestAiRetrievalConfigMutation,
  useTestAiAgentConfigMutation,
  useUpdateAiSpaceConfigMutation,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiAssistantGender,
  AiModelTestResult,
  AiAgentTestResult,
  AiQuickCommand,
  AiRetrievalAdapter,
  AiRetrievalTestResult,
  AiSpaceConfigUpdate,
} from "@/features/ai/types/ai.types.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import classes from "./ai-space-settings.module.css";
import {
  buildAiAssistantIdentityUpdate,
  hasInvalidAiAssistantNameCharacters,
  resolveAiAssistantText,
} from "@/features/ai/utils/ai-identity.ts";
import { AiContentExclusionsSettings } from "./ai-content-exclusions-settings.tsx";
import AiSpaceExternalMcpSettings from "@/features/ai-external-mcp/components/ai-space-external-mcp-settings.tsx";

type AiSettingsForm = {
  enabled: boolean;
  agentEnabled: boolean;
  assistantNameEnabled: boolean;
  assistantName: string;
  assistantGender: AiAssistantGender;
  baseUrl: string;
  chatModel: string;
  systemInstructions: string;
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
  contextWindow: number;
  requestTimeoutMs: number;
  dailyRequestLimitPerUser: number;
  dailyTokenLimitPerSpace: number;
  retentionDays: number;
  visionEnabled: boolean;
  reasoningEnabled: boolean;
  retrievalEnabled: boolean;
  retrievalAdapter: Exclude<AiRetrievalAdapter, "none">;
  retrievalUrl: string;
  retrievalApiKey: string;
  openWebUiBaseUrl: string;
  openWebUiKnowledgeId: string;
  openWebUiApiKey: string;
  retrievalTimeoutMs: number;
  retrievalMaxResults: number;
  quickCommands: AiQuickCommand[];
};

const DEFAULT_FORM: AiSettingsForm = {
  enabled: false,
  agentEnabled: false,
  assistantNameEnabled: false,
  assistantName: "",
  assistantGender: "masculine",
  baseUrl: "",
  chatModel: "",
  apiKey: "",
  systemInstructions: "",
  temperature: AI_SPACE_CONFIG_DEFAULTS.temperature,
  maxOutputTokens: AI_SPACE_CONFIG_DEFAULTS.maxOutputTokens,
  contextWindow: AI_SPACE_CONFIG_DEFAULTS.contextWindow,
  requestTimeoutMs: AI_SPACE_CONFIG_DEFAULTS.requestTimeoutMs,
  dailyRequestLimitPerUser: AI_SPACE_CONFIG_DEFAULTS.dailyRequestLimitPerUser,
  dailyTokenLimitPerSpace: AI_SPACE_CONFIG_DEFAULTS.dailyTokenLimitPerSpace,
  retentionDays: AI_SPACE_CONFIG_DEFAULTS.retentionDays,
  visionEnabled: false,
  reasoningEnabled: false,
  retrievalEnabled: false,
  retrievalAdapter: "http-json-v1",
  retrievalUrl: "",
  retrievalApiKey: "",
  openWebUiBaseUrl: "",
  openWebUiKnowledgeId: "",
  openWebUiApiKey: "",
  retrievalTimeoutMs: AI_RETRIEVAL_CONFIG_DEFAULTS.timeoutMs,
  retrievalMaxResults: AI_RETRIEVAL_CONFIG_DEFAULTS.maxResults,
  quickCommands: [],
};

export type AiSpaceSettingsSection =
  | "all"
  | "overview"
  | "identity"
  | "content"
  | "model"
  | "behavior"
  | "agent"
  | "externalTools"
  | "retrieval"
  | "limits";

export function AiSpaceSettings({
  spaceId,
  section = "all",
  onDirtyChange,
}: {
  spaceId: string;
  section?: AiSpaceSettingsSection;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const numberInputControlProps = {
    hideControls: true,
  };
  const visibilityToggleButtonProps = {
    "aria-label": t("ai.ux.toggleSecretVisibility"),
    style: { minWidth: 32, minHeight: 32 },
  };
  const configQuery = useAiSpaceConfigQuery(spaceId);
  const statusQuery = useAiSpaceStatusQuery(spaceId);
  const updateConfig = useUpdateAiSpaceConfigMutation(spaceId);
  const testModel = useTestAiModelConfigMutation(spaceId);
  const testRetrieval = useTestAiRetrievalConfigMutation(spaceId);
  const testAgent = useTestAiAgentConfigMutation(spaceId);
  const [modelTestResult, setModelTestResult] = useState<
    AiModelTestResult | { ok: false; errorMessage: string } | null
  >(null);
  const [retrievalTestResult, setRetrievalTestResult] = useState<
    AiRetrievalTestResult | { ok: false; errorMessage: string } | null
  >(null);
  const [agentTestResult, setAgentTestResult] = useState<
    AiAgentTestResult | { ok: false; errorMessage: string } | null
  >(null);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [clearRetrievalApiKey, setClearRetrievalApiKey] = useState(false);
  const [clearOpenWebUiApiKey, setClearOpenWebUiApiKey] = useState(false);
  const form = useForm<AiSettingsForm>({
    initialValues: DEFAULT_FORM,
    validate: {
      assistantName: (value, values) => {
        if (!values.assistantNameEnabled) {
          return null;
        }
        if (!value.trim()) {
          return t("ai.settings.assistantNameRequired");
        }
        if (
          Array.from(value.trim()).length > AI_ASSISTANT_NAME_MAX_LENGTH ||
          hasInvalidAiAssistantNameCharacters(value)
        ) {
          return t("ai.settings.assistantNameInvalid");
        }
        return null;
      },
      baseUrl: (value) =>
        /^https?:\/\/.+/i.test(value) ? null : t("ai.settings.invalidUrl"),
      chatModel: (value) =>
        value.trim() ? null : t("ai.settings.modelRequired"),
      retrievalUrl: (value, values) =>
        values.retrievalEnabled &&
        values.retrievalAdapter === "http-json-v1" &&
        !/^https?:\/\/.+/i.test(value)
          ? t("ai.settings.invalidUrl")
          : null,
      openWebUiBaseUrl: (value, values) =>
        values.retrievalEnabled &&
        values.retrievalAdapter === "open-webui-knowledge-v1" &&
        !isHttpOrigin(value)
          ? t("ai.settings.openWebUiBaseUrlInvalid")
          : null,
      openWebUiKnowledgeId: (value, values) =>
        values.retrievalEnabled &&
        values.retrievalAdapter === "open-webui-knowledge-v1" &&
        !value.trim()
          ? t("ai.settings.openWebUiKnowledgeIdRequired")
          : null,
      openWebUiApiKey: (value, values) =>
        values.retrievalEnabled &&
        values.retrievalAdapter === "open-webui-knowledge-v1" &&
        !value.trim() &&
        (!configQuery.data?.retrieval.openWebUi.apiKeyConfigured ||
          clearOpenWebUiApiKey)
          ? t("ai.settings.openWebUiApiKeyRequired")
          : null,
    },
  });

  useEffect(() => {
    if (!configQuery.data) {
      form.setValues(DEFAULT_FORM);
      return;
    }
    const config = configQuery.data;
    form.setValues({
      enabled: config.enabled,
      agentEnabled: config.agentEnabled,
      assistantNameEnabled: config.assistantNameEnabled,
      assistantName: config.assistantName ?? "",
      assistantGender: config.assistantGender,
      baseUrl: config.baseUrl,
      chatModel: config.chatModel,
      apiKey: "",
      systemInstructions: config.systemInstructions ?? "",
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      contextWindow: config.contextWindow,
      requestTimeoutMs: config.requestTimeoutMs,
      dailyRequestLimitPerUser: config.dailyRequestLimitPerUser,
      dailyTokenLimitPerSpace: config.dailyTokenLimitPerSpace,
      retentionDays: config.retentionDays,
      visionEnabled: config.visionEnabled,
      reasoningEnabled: config.reasoningEnabled ?? false,
      retrievalEnabled: config.retrieval.adapter !== "none",
      retrievalAdapter:
        config.retrieval.adapter === "open-webui-knowledge-v1" ||
        (config.retrieval.adapter === "none" &&
          !config.retrieval.url &&
          Boolean(config.retrieval.openWebUi.baseUrl))
          ? "open-webui-knowledge-v1"
          : "http-json-v1",
      retrievalUrl: config.retrieval.url ?? "",
      retrievalApiKey: "",
      openWebUiBaseUrl: config.retrieval.openWebUi.baseUrl ?? "",
      openWebUiKnowledgeId: config.retrieval.openWebUi.knowledgeId ?? "",
      openWebUiApiKey: "",
      retrievalTimeoutMs: config.retrieval.timeoutMs,
      retrievalMaxResults: config.retrieval.maxResults,
      quickCommands: config.quickCommands ?? [],
    });
    form.resetDirty();
    setClearApiKey(false);
    setClearRetrievalApiKey(false);
    setClearOpenWebUiApiKey(false);
  }, [configQuery.data]);

  useEffect(() => {
    onDirtyChange?.(
      form.isDirty() ||
        clearApiKey ||
        clearRetrievalApiKey ||
        clearOpenWebUiApiKey,
    );
  }, [
    clearApiKey,
    clearOpenWebUiApiKey,
    clearRetrievalApiKey,
    form.values,
    onDirtyChange,
  ]);

  const toRetrievalPayload = (
    values: AiSettingsForm,
  ): NonNullable<AiSpaceConfigUpdate["retrieval"]> => ({
    adapter: values.retrievalEnabled ? values.retrievalAdapter : "none",
    ...(values.retrievalEnabled && values.retrievalAdapter === "http-json-v1"
      ? {
          url: values.retrievalUrl.trim() || null,
          ...(values.retrievalApiKey.trim()
            ? { apiKey: values.retrievalApiKey.trim() }
            : {}),
          ...(clearRetrievalApiKey ? { clearApiKey: true } : {}),
        }
      : clearRetrievalApiKey
        ? { clearApiKey: true }
        : {}),
    ...(values.retrievalEnabled &&
    values.retrievalAdapter === "open-webui-knowledge-v1"
      ? {
          openWebUi: {
            baseUrl: values.openWebUiBaseUrl.trim() || null,
            knowledgeId: values.openWebUiKnowledgeId.trim() || null,
            ...(values.openWebUiApiKey.trim()
              ? { apiKey: values.openWebUiApiKey.trim() }
              : {}),
            ...(clearOpenWebUiApiKey ? { clearApiKey: true } : {}),
          },
        }
      : clearOpenWebUiApiKey
        ? { openWebUi: { clearApiKey: true } }
        : {}),
    timeoutMs: values.retrievalTimeoutMs,
    maxResults: values.retrievalMaxResults,
  });

  const toPayload = (
    values: AiSettingsForm,
    target: AiSpaceSettingsSection = section,
  ): AiSpaceConfigUpdate => {
    const include = (candidate: AiSpaceSettingsSection) =>
      target === "all" || target === candidate;
    return {
      ...(include("overview") ? { enabled: values.enabled } : {}),
      ...(include("identity") ? buildAiAssistantIdentityUpdate(values) : {}),
      ...(include("model")
        ? {
            provider: "openai-compatible" as const,
            baseUrl: values.baseUrl.trim(),
            chatModel: values.chatModel.trim(),
            ...(values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
            ...(clearApiKey ? { clearApiKey: true } : {}),
            temperature: values.temperature,
            maxOutputTokens: values.maxOutputTokens,
            contextWindow: values.contextWindow,
            requestTimeoutMs: values.requestTimeoutMs,
            visionEnabled: values.visionEnabled,
            reasoningEnabled: values.reasoningEnabled,
          }
        : {}),
      ...(include("behavior")
        ? {
            systemInstructions: values.systemInstructions.trim() || null,
            quickCommands: values.quickCommands.map((command, position) => ({
              ...command,
              position,
            })),
          }
        : {}),
      ...(include("agent") ? { agentEnabled: values.agentEnabled } : {}),
      ...(include("retrieval")
        ? { retrieval: toRetrievalPayload(values) }
        : {}),
      ...(include("limits")
        ? {
            dailyRequestLimitPerUser: values.dailyRequestLimitPerUser,
            dailyTokenLimitPerSpace: values.dailyTokenLimitPerSpace,
            retentionDays: values.retentionDays,
          }
        : {}),
    };
  };

  const hasValidationError = (fields: Array<keyof AiSettingsForm>) =>
    fields.some((field) => form.validateField(field).hasError);

  const validateSection = (target: AiSpaceSettingsSection) => {
    if (target === "all") {
      return form.validate().hasErrors;
    }
    if (target === "identity") {
      return hasValidationError(["assistantName"]);
    }
    if (target === "model") {
      return hasValidationError(["baseUrl", "chatModel"]);
    }
    if (target === "retrieval") {
      return hasValidationError([
        "retrievalUrl",
        "openWebUiBaseUrl",
        "openWebUiKnowledgeId",
        "openWebUiApiKey",
      ]);
    }
    return false;
  };

  const confirmClearKey = (target: "model" | "retrieval" | "openWebUi") => {
    modals.openConfirmModal({
      title:
        target === "model"
          ? t("ai.settings.clearApiKey")
          : target === "openWebUi"
            ? t("ai.settings.clearOpenWebUiApiKey")
            : t("ai.settings.clearRetrievalApiKey"),
      children: <Text size="sm">{t("ai.settings.clearApiKeyConfirm")}</Text>,
      labels: {
        confirm: t("ai.delete"),
        cancel: t("ai.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: () => {
        if (target === "model") {
          setClearApiKey(true);
          form.setFieldValue("apiKey", "");
        } else if (target === "retrieval") {
          setClearRetrievalApiKey(true);
          form.setFieldValue("retrievalApiKey", "");
        } else {
          setClearOpenWebUiApiKey(true);
          form.setFieldValue("openWebUiApiKey", "");
        }
      },
    });
  };

  const save = async () => {
    if (validateSection(section)) {
      return;
    }
    try {
      await updateConfig.mutateAsync(toPayload(form.values));
      if (section === "all" || section === "model") {
        form.setFieldValue("apiKey", "");
        setClearApiKey(false);
      }
      if (section === "all" || section === "retrieval") {
        form.setFieldValue("retrievalApiKey", "");
        form.setFieldValue("openWebUiApiKey", "");
        setClearRetrievalApiKey(false);
        setClearOpenWebUiApiKey(false);
      }
      form.resetDirty();
      onDirtyChange?.(false);
      notifications.show({ message: t("ai.settings.saved") });
    } catch (error) {
      notifications.show({
        message: error?.["response"]?.data?.code
          ? resolveAiErrorMessage(t, i18n, error["response"].data.code)
          : t("ai.settings.saveFailed"),
        color: "red",
      });
    }
  };

  const test = async () => {
    if (validateSection("model")) {
      return;
    }
    try {
      const result = await testModel.mutateAsync(toPayload(form.values));
      setModelTestResult(result);
      notifications.show({
        message: result.ok
          ? t("ai.settings.testSucceeded")
          : t("ai.settings.testFailed"),
        color: result.ok ? "green" : "red",
      });
    } catch (error) {
      setModelTestResult({
        ok: false,
        errorMessage: error?.["response"]?.data?.code
          ? resolveAiErrorMessage(t, i18n, error["response"].data.code)
          : t("ai.settings.testFailed"),
      });
    }
  };

  const testRetrievalConnection = async () => {
    if (validateSection("retrieval") || !form.values.retrievalEnabled) {
      return;
    }
    try {
      const result = await testRetrieval.mutateAsync(
        toPayload(form.values, "retrieval"),
      );
      setRetrievalTestResult(result);
      const isEmpty = result.ok && result.state === "empty";
      notifications.show({
        message: isEmpty
          ? t("ai.settings.retrievalTestEmpty")
          : result.ok
            ? t("ai.settings.retrievalTestSucceeded")
            : t("ai.settings.retrievalTestFailed"),
        color: isEmpty ? "yellow" : result.ok ? "green" : "red",
      });
    } catch (error) {
      setRetrievalTestResult({
        ok: false,
        errorMessage: error?.["response"]?.data?.code
          ? resolveAiErrorMessage(t, i18n, error["response"].data.code)
          : t("ai.settings.retrievalTestFailed"),
      });
    }
  };

  const testAgentConnection = async () => {
    if (validateSection("model")) {
      return;
    }
    try {
      const result = await testAgent.mutateAsync(
        toPayload(form.values, "model"),
      );
      setAgentTestResult(result);
      notifications.show({
        message: t("ai.settings.agentTestSucceeded"),
        color: "green",
      });
    } catch (error) {
      setAgentTestResult({
        ok: false,
        errorMessage: error?.["response"]?.data?.code
          ? resolveAiErrorMessage(t, i18n, error["response"].data.code)
          : t("ai.settings.agentTestFailed"),
      });
    }
  };

  if (configQuery.isLoading) {
    return <Text size="sm">{t("ai.settings.loading")}</Text>;
  }

  if (configQuery.isError) {
    return (
      <Alert color="red" title={t("ai.settings.loadFailed")}>
        {t("ai.settings.adminOnly")}
      </Alert>
    );
  }

  const formAssistantIdentity =
    form.values.assistantNameEnabled && form.values.assistantName.trim()
      ? {
          name: form.values.assistantName.trim(),
          gender: form.values.assistantGender,
        }
      : null;
  const showSection = (candidate: AiSpaceSettingsSection) =>
    section === "all" || section === candidate;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className={classes.form}
    >
      <Stack gap="lg">
        {section === "all" && (
          <Stack gap={4} className={classes.pageHeader}>
            <Text fw={600}>{t("ai.settings.title")}</Text>
            <Text size="sm" c="dimmed">
              {t("ai.settings.description")}
            </Text>
          </Stack>
        )}

        {showSection("overview") && (
          <Paper withBorder radius="md" p="md" className={classes.enableCard}>
            <Switch
              label={resolveAiAssistantText(
                t,
                "settings.enable",
                formAssistantIdentity,
              )}
              description={t("ai.settings.enableDescription")}
              {...form.getInputProps("enabled", { type: "checkbox" })}
            />
          </Paper>
        )}

        {showSection("identity") && (
          <SettingsSection
              icon={<IconMessageCircle size={18} />}
              title={t("ai.settings.identitySection")}
              description={t("ai.settings.identityDescription")}
            >
              <Stack gap="md">
                <Switch
                  label={t("ai.settings.customNameEnabled")}
                  description={t("ai.settings.customNameEnabledDescription")}
                  {...form.getInputProps("assistantNameEnabled", {
                    type: "checkbox",
                  })}
                />
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput
                    label={t("ai.settings.assistantName")}
                    description={t("ai.settings.assistantNameDescription")}
                    required={form.values.assistantNameEnabled}
                    disabled={!form.values.assistantNameEnabled}
                    {...form.getInputProps("assistantName")}
                  />
                  <Select
                    label={t("ai.settings.assistantGender")}
                    description={t("ai.settings.assistantGenderDescription")}
                    data={[
                      {
                        value: "masculine",
                        label: t("ai.settings.assistantGenderMasculine"),
                      },
                      {
                        value: "feminine",
                        label: t("ai.settings.assistantGenderFeminine"),
                      },
                    ]}
                    allowDeselect={false}
                    disabled={!form.values.assistantNameEnabled}
                    {...form.getInputProps("assistantGender")}
                  />
                </SimpleGrid>
              </Stack>
          </SettingsSection>
        )}

        {showSection("content") && (
          <AiContentExclusionsSettings spaceId={spaceId} />
        )}

        {showSection("overview") && statusQuery.data?.usage && (
          <SettingsSection
            icon={<IconActivity size={18} />}
            title={t("ai.settings.usageSection")}
            description={t("ai.settings.usageDescription")}
          >
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
              <UsageMetric
                label={t("ai.settings.requestsToday")}
                value={statusQuery.data.usage.requestsToday}
              />
              <UsageMetric
                label={t("ai.settings.tokensToday")}
                value={statusQuery.data.usage.tokensToday}
              />
              <UsageMetric
                label={t("ai.settings.activeRuns")}
                value={statusQuery.data.usage.activeRuns}
              />
            </SimpleGrid>
          </SettingsSection>
        )}

        {showSection("model") && (
          <SettingsSection
            icon={<IconRobot size={18} />}
            title={t("ai.settings.modelSection")}
            description={t("ai.settings.modelSectionDescription")}
          >
            <Stack gap="md">
              <TextInput
                label={t("ai.settings.baseUrl")}
                description={t("ai.settings.baseUrlDescription")}
                placeholder="http://127.0.0.1:56254/v1"
                required
                {...form.getInputProps("baseUrl")}
              />
              <TextInput
                label={t("ai.settings.chatModel")}
                description={t("ai.settings.chatModelDescription")}
                placeholder="google/gemma-4-26b-a4b-qat"
                required
                {...form.getInputProps("chatModel")}
              />
              <PasswordInput
                visibilityToggleButtonProps={visibilityToggleButtonProps}
                label={t("ai.settings.apiKey")}
                description={
                  configQuery.data?.apiKeyConfigured && !clearApiKey
                    ? t("ai.settings.apiKeyConfigured")
                    : t("ai.settings.apiKeyOptional")
                }
                placeholder={
                  configQuery.data?.apiKeyConfigured && !clearApiKey
                    ? "••••••••"
                    : undefined
                }
                disabled={clearApiKey}
                {...form.getInputProps("apiKey")}
              />
              {configQuery.data?.apiKeyConfigured && (
                <Button
                  type="button"
                  variant={clearApiKey ? "filled" : "subtle"}
                  color={clearApiKey ? "red" : "gray"}
                  size="xs"
                  leftSection={<IconKeyOff size={15} />}
                  className={classes.keyAction}
                  onClick={() =>
                    clearApiKey
                      ? setClearApiKey(false)
                      : confirmClearKey("model")
                  }
                >
                  {clearApiKey
                    ? t("ai.settings.keepApiKey")
                    : t("ai.settings.clearApiKey")}
                </Button>
              )}

              <Accordion
                variant="contained"
                radius="md"
                className={classes.inlineAccordion}
              >
                <Accordion.Item value="advanced-model">
                  <Accordion.Control
                    icon={<IconAdjustments size={18} />}
                    className={classes.accordionControl}
                  >
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {t("ai.settings.advancedModelSection")}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("ai.settings.advancedModelDescription")}
                      </Text>
                    </Stack>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="md">
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <NumberInput
                          {...numberInputControlProps}
                          label={t("ai.settings.temperature")}
                          description={t("ai.settings.temperatureDescription")}
                          min={0}
                          max={2}
                          step={0.1}
                          decimalScale={2}
                          {...form.getInputProps("temperature")}
                        />
                        <NumberInput
                          {...numberInputControlProps}
                          label={t("ai.settings.maxOutputTokens")}
                          description={t(
                            "ai.settings.maxOutputTokensDescription",
                          )}
                          min={1}
                          max={131072}
                          {...form.getInputProps("maxOutputTokens")}
                        />
                        <NumberInput
                          {...numberInputControlProps}
                          label={t("ai.settings.contextWindow")}
                          description={t(
                            "ai.settings.contextWindowDescription",
                          )}
                          min={1024}
                          max={2000000}
                          {...form.getInputProps("contextWindow")}
                        />
                        <NumberInput
                          {...numberInputControlProps}
                          label={t("ai.settings.timeout")}
                          description={t("ai.settings.timeoutDescription")}
                          min={1000}
                          max={600000}
                          {...form.getInputProps("requestTimeoutMs")}
                        />
                      </SimpleGrid>
                      <Switch
                        label={t("ai.settings.vision")}
                        description={t("ai.settings.visionDescription")}
                        {...form.getInputProps("visionEnabled", {
                          type: "checkbox",
                        })}
                      />
                      <Switch
                        label={t("ai.settings.reasoning")}
                        description={t("ai.settings.reasoningDescription")}
                        {...form.getInputProps("reasoningEnabled", {
                          type: "checkbox",
                        })}
                      />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>

              {modelTestResult && (
                <Alert
                  color={modelTestResult.ok ? "green" : "red"}
                  icon={
                    modelTestResult.ok ? <IconCheck size={17} /> : undefined
                  }
                >
                  {"errorMessage" in modelTestResult
                    ? modelTestResult.errorMessage
                    : modelTestResult.ok
                      ? t("ai.settings.testSucceeded")
                      : t("ai.settings.testFailed")}
                </Alert>
              )}
            </Stack>
          </SettingsSection>
        )}

        {showSection("agent") && (
          <SettingsSection
            icon={<IconRobot size={18} />}
            title={t("ai.settings.agentSection")}
            description={t("ai.settings.agentSectionDescription")}
          >
            <Stack gap="md">
              <Switch
                label={t("ai.settings.agentEnabled")}
                description={t("ai.settings.agentEnabledDescription")}
                disabled={
                  !configQuery.data?.agentVerifiedAt &&
                  !configQuery.data?.agentEnabled
                }
                {...form.getInputProps("agentEnabled", { type: "checkbox" })}
              />
              <Button
                type="button"
                variant="default"
                leftSection={<IconPlayerPlay size={16} />}
                loading={testAgent.isPending}
                onClick={() => void testAgentConnection()}
              >
                {t("ai.settings.testAgent")}
              </Button>
              {agentTestResult && (
                <Alert
                  color={agentTestResult.ok ? "green" : "red"}
                  icon={
                    agentTestResult.ok ? <IconCheck size={17} /> : undefined
                  }
                >
                  {"errorMessage" in agentTestResult
                    ? agentTestResult.errorMessage
                    : t("ai.settings.agentTestSucceeded")}
                </Alert>
              )}
            </Stack>
          </SettingsSection>
        )}

        {/* External tools are only reachable in agent mode, so this sits next
            to the agent section. It persists on its own, like content. */}
        {showSection("externalTools") && (
          <AiSpaceExternalMcpSettings spaceId={spaceId} />
        )}

        {showSection("behavior") && (
          <SettingsSection
            icon={<IconMessageCircle size={18} />}
            title={t("ai.settings.behaviorSection")}
            description={t("ai.settings.behaviorSectionDescription")}
          >
            <Stack gap="lg">
              <Textarea
                label={t("ai.settings.systemInstructions")}
                description={t("ai.settings.systemInstructionsDescription")}
                minRows={3}
                maxRows={8}
                autosize
                {...form.getInputProps("systemInstructions")}
              />

              <Stack gap="sm">
                <div className={classes.quickHeader}>
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>
                      {t("ai.settings.quickCommands")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("ai.settings.quickCommandsDescription")}
                    </Text>
                  </Stack>
                  <Button
                    type="button"
                    size="compact-sm"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    className={classes.addCommand}
                    onClick={() =>
                      form.insertListItem("quickCommands", {
                        id: crypto.randomUUID(),
                        label: "",
                        prompt: "",
                        description: "",
                        enabled: true,
                        position: form.values.quickCommands.length,
                      })
                    }
                  >
                    {t("ai.settings.addCommand")}
                  </Button>
                </div>

                {form.values.quickCommands.length === 0 && (
                  <EmptyState
                    compact
                    icon={IconBolt}
                    title={t("ai.settings.noQuickCommands")}
                    description={t("ai.settings.noQuickCommandsDescription")}
                  />
                )}

                {form.values.quickCommands.map((command, index) => (
                  <Paper
                    key={command.id}
                    withBorder
                    radius="md"
                    p="sm"
                    className={classes.commandCard}
                  >
                    <Stack gap="md">
                      <div className={classes.commandTop}>
                        <TextInput
                          label={t("ai.settings.commandLabel")}
                          description={t("ai.settings.commandLabelDescription")}
                          maxLength={120}
                          {...form.getInputProps(
                            `quickCommands.${index}.label`,
                          )}
                        />
                        <div className={classes.commandToolbar}>
                          <Switch
                            label={t("ai.settings.commandEnabled")}
                            description={t(
                              "ai.settings.commandEnabledDescription",
                            )}
                            className={classes.commandToggle}
                            {...form.getInputProps(
                              `quickCommands.${index}.enabled`,
                              {
                                type: "checkbox",
                              },
                            )}
                          />
                          <div className={classes.commandActions}>
                            <AccessibleActionIcon
                              type="button"
                              variant="subtle"
                              label={t("ai.settings.moveCommandUp")}
                              disabled={index === 0}
                              onClick={() =>
                                form.reorderListItem("quickCommands", {
                                  from: index,
                                  to: index - 1,
                                })
                              }
                            >
                              <IconArrowUp size={16} />
                            </AccessibleActionIcon>
                            <AccessibleActionIcon
                              type="button"
                              variant="subtle"
                              label={t("ai.settings.moveCommandDown")}
                              disabled={
                                index === form.values.quickCommands.length - 1
                              }
                              onClick={() =>
                                form.reorderListItem("quickCommands", {
                                  from: index,
                                  to: index + 1,
                                })
                              }
                            >
                              <IconArrowDown size={16} />
                            </AccessibleActionIcon>
                            <AccessibleActionIcon
                              type="button"
                              variant="subtle"
                              color="red"
                              label={t("ai.settings.deleteCommand")}
                              onClick={() =>
                                form.removeListItem("quickCommands", index)
                              }
                            >
                              <IconTrash size={16} />
                            </AccessibleActionIcon>
                          </div>
                        </div>
                      </div>

                      <TextInput
                        label={t("ai.settings.commandDescription")}
                        description={t("ai.settings.commandDescriptionHint")}
                        maxLength={240}
                        {...form.getInputProps(
                          `quickCommands.${index}.description`,
                        )}
                      />
                      <Textarea
                        label={t("ai.settings.commandPrompt")}
                        description={t("ai.settings.commandPromptDescription")}
                        minRows={2}
                        maxRows={5}
                        autosize
                        maxLength={4000}
                        {...form.getInputProps(`quickCommands.${index}.prompt`)}
                      />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </SettingsSection>
        )}

        {showSection("retrieval") && (
          <SettingsSection
            icon={<IconSearch size={18} />}
            title={t("ai.settings.retrievalSection")}
            description={t("ai.settings.retrievalDescription")}
          >
            <Stack gap="md">
              <Switch
                label={t("ai.settings.enableRetrieval")}
                description={t("ai.settings.retrievalFallback")}
                {...form.getInputProps("retrievalEnabled", {
                  type: "checkbox",
                })}
              />
              {form.values.retrievalEnabled && (
                <Stack gap="md" className={classes.retrievalFields}>
                  <Select
                    label={t("ai.settings.retrievalAdapter")}
                    description={t("ai.settings.retrievalAdapterDescription")}
                    data={[
                      {
                        value: "http-json-v1",
                        label: t("ai.settings.retrievalAdapterHttpJson"),
                      },
                      {
                        value: "open-webui-knowledge-v1",
                        label: t("ai.settings.retrievalAdapterOpenWebUi"),
                      },
                    ]}
                    allowDeselect={false}
                    {...form.getInputProps("retrievalAdapter")}
                  />
                  {form.values.retrievalAdapter === "http-json-v1" ? (
                    <>
                      <TextInput
                        label={t("ai.settings.retrievalUrl")}
                        description={t("ai.settings.retrievalUrlDescription")}
                        placeholder="https://rag.example.com/query"
                        required
                        {...form.getInputProps("retrievalUrl")}
                      />
                      <PasswordInput
                        visibilityToggleButtonProps={
                          visibilityToggleButtonProps
                        }
                        label={t("ai.settings.retrievalApiKey")}
                        description={
                          configQuery.data?.retrieval.apiKeyConfigured &&
                          !clearRetrievalApiKey
                            ? t("ai.settings.apiKeyConfigured")
                            : t("ai.settings.apiKeyOptional")
                        }
                        disabled={clearRetrievalApiKey}
                        {...form.getInputProps("retrievalApiKey")}
                      />
                      {configQuery.data?.retrieval.apiKeyConfigured && (
                        <Button
                          type="button"
                          variant={clearRetrievalApiKey ? "filled" : "subtle"}
                          color={clearRetrievalApiKey ? "red" : "gray"}
                          size="xs"
                          leftSection={<IconKeyOff size={15} />}
                          className={classes.keyAction}
                          onClick={() =>
                            clearRetrievalApiKey
                              ? setClearRetrievalApiKey(false)
                              : confirmClearKey("retrieval")
                          }
                        >
                          {clearRetrievalApiKey
                            ? t("ai.settings.keepApiKey")
                            : t("ai.settings.clearRetrievalApiKey")}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <TextInput
                        label={t("ai.settings.openWebUiBaseUrl")}
                        description={t(
                          "ai.settings.openWebUiBaseUrlDescription",
                        )}
                        placeholder="https://open-webui.example.com"
                        required
                        {...form.getInputProps("openWebUiBaseUrl")}
                      />
                      <TextInput
                        label={t("ai.settings.openWebUiKnowledgeId")}
                        description={t(
                          "ai.settings.openWebUiKnowledgeIdDescription",
                        )}
                        required
                        {...form.getInputProps("openWebUiKnowledgeId")}
                      />
                      <PasswordInput
                        visibilityToggleButtonProps={
                          visibilityToggleButtonProps
                        }
                        label={t("ai.settings.openWebUiApiKey")}
                        description={
                          configQuery.data?.retrieval.openWebUi
                            .apiKeyConfigured && !clearOpenWebUiApiKey
                            ? t("ai.settings.apiKeyConfigured")
                            : t("ai.settings.openWebUiApiKeyRequired")
                        }
                        disabled={clearOpenWebUiApiKey}
                        {...form.getInputProps("openWebUiApiKey")}
                      />
                      {configQuery.data?.retrieval.openWebUi
                        .apiKeyConfigured && (
                        <Button
                          type="button"
                          variant={clearOpenWebUiApiKey ? "filled" : "subtle"}
                          color={clearOpenWebUiApiKey ? "red" : "gray"}
                          size="xs"
                          leftSection={<IconKeyOff size={15} />}
                          className={classes.keyAction}
                          onClick={() =>
                            clearOpenWebUiApiKey
                              ? setClearOpenWebUiApiKey(false)
                              : confirmClearKey("openWebUi")
                          }
                        >
                          {clearOpenWebUiApiKey
                            ? t("ai.settings.keepApiKey")
                            : t("ai.settings.clearOpenWebUiApiKey")}
                        </Button>
                      )}
                    </>
                  )}
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <NumberInput
                      {...numberInputControlProps}
                      label={t("ai.settings.retrievalTimeout")}
                      description={t("ai.settings.retrievalTimeoutDescription")}
                      min={1000}
                      max={60000}
                      {...form.getInputProps("retrievalTimeoutMs")}
                    />
                    <NumberInput
                      {...numberInputControlProps}
                      label={t("ai.settings.retrievalMaxResults")}
                      description={t(
                        "ai.settings.retrievalMaxResultsDescription",
                      )}
                      min={1}
                      max={20}
                      {...form.getInputProps("retrievalMaxResults")}
                    />
                  </SimpleGrid>
                  <Button
                    type="button"
                    variant="default"
                    leftSection={<IconPlayerPlay size={16} />}
                    loading={testRetrieval.isPending}
                    className={classes.secondaryAction}
                    onClick={() => void testRetrievalConnection()}
                  >
                    {t("ai.settings.testRetrieval")}
                  </Button>
                  {retrievalTestResult && (
                    <Alert
                      color={
                        retrievalTestResult.ok &&
                        !("errorMessage" in retrievalTestResult) &&
                        retrievalTestResult.state === "empty"
                          ? "yellow"
                          : retrievalTestResult.ok
                            ? "green"
                            : "red"
                      }
                      py="xs"
                    >
                      {"errorMessage" in retrievalTestResult
                        ? retrievalTestResult.errorMessage
                        : retrievalTestResult.ok
                          ? t(
                              retrievalTestResult.state === "empty"
                                ? "ai.settings.retrievalTestEmpty"
                                : "ai.settings.retrievalTestSucceeded",
                              {
                                version:
                                  retrievalTestResult.remoteVersion ??
                                  t("ai.settings.unknownVersion"),
                              },
                            )
                          : t("ai.settings.retrievalTestFailed")}
                    </Alert>
                  )}
                </Stack>
              )}
            </Stack>
          </SettingsSection>
        )}

        {showSection("limits") && (
          <Accordion
            variant="contained"
            radius="md"
            className={classes.limitsAccordion}
          >
            <Accordion.Item value="limits">
              <Accordion.Control
                icon={<IconGauge size={18} />}
                className={classes.accordionControl}
              >
                <Stack gap={2}>
                  <Text size="sm" fw={600}>
                    {t("ai.settings.limitsSection")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("ai.settings.limitsDescription")}
                  </Text>
                </Stack>
              </Accordion.Control>
              <Accordion.Panel>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <NumberInput
                    {...numberInputControlProps}
                    label={t("ai.settings.userDailyLimit")}
                    description={t("ai.settings.userDailyLimitDescription")}
                    min={1}
                    max={100000}
                    {...form.getInputProps("dailyRequestLimitPerUser")}
                  />
                  <NumberInput
                    {...numberInputControlProps}
                    label={t("ai.settings.spaceTokenLimit")}
                    description={t("ai.settings.spaceTokenLimitDescription")}
                    min={1}
                    max={1000000000}
                    {...form.getInputProps("dailyTokenLimitPerSpace")}
                  />
                  <NumberInput
                    {...numberInputControlProps}
                    label={t("ai.settings.retentionDays")}
                    description={t("ai.settings.retentionDaysDescription")}
                    min={1}
                    max={365}
                    {...form.getInputProps("retentionDays")}
                  />
                </SimpleGrid>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        {/* Both of these sections persist immediately and contribute nothing to
            the shared form payload, so a Save button here would fire an empty
            PATCH. */}
        {section !== "content" && section !== "externalTools" && (
          <div className={classes.actionBar}>
            <Group justify="flex-end" className={classes.actionGroup}>
              {showSection("model") && (
                <Button
                  type="button"
                  variant="default"
                  leftSection={<IconPlayerPlay size={16} />}
                  loading={testModel.isPending}
                  onClick={() => void test()}
                >
                  {t("ai.settings.test")}
                </Button>
              )}
              <Button type="submit" loading={updateConfig.isPending}>
                {t("ai.save")}
              </Button>
            </Group>
          </div>
        )}
      </Stack>
    </form>
  );
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="md" className={classes.section}>
      <Group wrap="nowrap" align="flex-start" gap="sm" mb="md">
        <ThemeIcon variant="light" radius="md" size="lg">
          {icon}
        </ThemeIcon>
        <Stack gap={2}>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        </Stack>
      </Group>
      {children}
    </Paper>
  );
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <Paper withBorder p="sm" radius="md" className={classes.metric}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value.toLocaleString()}</Text>
    </Paper>
  );
}
