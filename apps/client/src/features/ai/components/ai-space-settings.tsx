import {
  Accordion,
  Alert,
  Button,
  Group,
  NumberInput,
  PasswordInput,
  Paper,
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
  AI_RETRIEVAL_CONFIG_DEFAULTS,
  AI_SPACE_CONFIG_DEFAULTS,
} from "@docmost/api-contract";
import {
  useAiSpaceConfigQuery,
  useAiSpaceStatusQuery,
  useTestAiModelConfigMutation,
  useTestAiRetrievalConfigMutation,
  useUpdateAiSpaceConfigMutation,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiModelTestResult,
  AiQuickCommand,
  AiRetrievalTestResult,
  AiSpaceConfigUpdate,
} from "@/features/ai/types/ai.types.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import classes from "./ai-space-settings.module.css";

type AiSettingsForm = {
  enabled: boolean;
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
  retrievalEnabled: boolean;
  retrievalUrl: string;
  retrievalApiKey: string;
  retrievalTimeoutMs: number;
  retrievalMaxResults: number;
  quickCommands: AiQuickCommand[];
};

const DEFAULT_FORM: AiSettingsForm = {
  enabled: false,
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
  retrievalEnabled: false,
  retrievalUrl: "",
  retrievalApiKey: "",
  retrievalTimeoutMs: AI_RETRIEVAL_CONFIG_DEFAULTS.timeoutMs,
  retrievalMaxResults: AI_RETRIEVAL_CONFIG_DEFAULTS.maxResults,
  quickCommands: [],
};

export function AiSpaceSettings({ spaceId }: { spaceId: string }) {
  const { t, i18n } = useTranslation();
  const configQuery = useAiSpaceConfigQuery(spaceId);
  const statusQuery = useAiSpaceStatusQuery(spaceId);
  const updateConfig = useUpdateAiSpaceConfigMutation(spaceId);
  const testModel = useTestAiModelConfigMutation(spaceId);
  const testRetrieval = useTestAiRetrievalConfigMutation(spaceId);
  const [modelTestResult, setModelTestResult] = useState<
    AiModelTestResult | { ok: false; errorMessage: string } | null
  >(null);
  const [retrievalTestResult, setRetrievalTestResult] = useState<
    AiRetrievalTestResult | { ok: false; errorMessage: string } | null
  >(null);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [clearRetrievalApiKey, setClearRetrievalApiKey] = useState(false);
  const form = useForm<AiSettingsForm>({
    initialValues: DEFAULT_FORM,
    validate: {
      baseUrl: (value) =>
        /^https?:\/\/.+/i.test(value) ? null : t("ai.settings.invalidUrl"),
      chatModel: (value) =>
        value.trim() ? null : t("ai.settings.modelRequired"),
      retrievalUrl: (value, values) =>
        values.retrievalEnabled && !/^https?:\/\/.+/i.test(value)
          ? t("ai.settings.invalidUrl")
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
      retrievalEnabled: config.retrieval.adapter !== "none",
      retrievalUrl: config.retrieval.url ?? "",
      retrievalApiKey: "",
      retrievalTimeoutMs: config.retrieval.timeoutMs,
      retrievalMaxResults: config.retrieval.maxResults,
      quickCommands: config.quickCommands ?? [],
    });
    form.resetDirty();
    setClearApiKey(false);
    setClearRetrievalApiKey(false);
  }, [configQuery.data]);

  const toPayload = (values: AiSettingsForm): AiSpaceConfigUpdate => ({
    enabled: values.enabled,
    provider: "openai-compatible",
    baseUrl: values.baseUrl.trim(),
    chatModel: values.chatModel.trim(),
    ...(values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
    ...(clearApiKey ? { clearApiKey: true } : {}),
    systemInstructions: values.systemInstructions.trim() || null,
    temperature: values.temperature,
    maxOutputTokens: values.maxOutputTokens,
    contextWindow: values.contextWindow,
    requestTimeoutMs: values.requestTimeoutMs,
    dailyRequestLimitPerUser: values.dailyRequestLimitPerUser,
    dailyTokenLimitPerSpace: values.dailyTokenLimitPerSpace,
    retentionDays: values.retentionDays,
    visionEnabled: values.visionEnabled,
    retrieval: {
      adapter: values.retrievalEnabled ? "http-json-v1" : "none",
      url: values.retrievalEnabled ? values.retrievalUrl.trim() : null,
      ...(values.retrievalApiKey.trim()
        ? { apiKey: values.retrievalApiKey.trim() }
        : {}),
      ...(clearRetrievalApiKey ? { clearApiKey: true } : {}),
      timeoutMs: values.retrievalTimeoutMs,
      maxResults: values.retrievalMaxResults,
    },
    quickCommands: values.quickCommands.map((command, position) => ({
      ...command,
      position,
    })),
  });

  const confirmClearKey = (target: "model" | "retrieval") => {
    modals.openConfirmModal({
      title:
        target === "model"
          ? t("ai.settings.clearApiKey")
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
        } else {
          setClearRetrievalApiKey(true);
          form.setFieldValue("retrievalApiKey", "");
        }
      },
    });
  };

  const save = form.onSubmit(async (values) => {
    try {
      await updateConfig.mutateAsync(toPayload(values));
      form.setFieldValue("apiKey", "");
      setClearApiKey(false);
      setClearRetrievalApiKey(false);
      form.resetDirty();
      notifications.show({ message: t("ai.settings.saved") });
    } catch (error) {
      notifications.show({
        message: error?.["response"]?.data?.code
          ? resolveAiErrorMessage(t, i18n, error["response"].data.code)
          : t("ai.settings.saveFailed"),
        color: "red",
      });
    }
  });

  const test = async () => {
    const validation = form.validate();
    if (validation.hasErrors) {
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
    const validation = form.validate();
    if (validation.hasErrors || !form.values.retrievalEnabled) {
      return;
    }
    try {
      const result = await testRetrieval.mutateAsync(toPayload(form.values));
      setRetrievalTestResult(result);
      notifications.show({
        message: result.ok
          ? t("ai.settings.retrievalTestSucceeded")
          : t("ai.settings.retrievalTestFailed"),
        color: result.ok ? "green" : "red",
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

  return (
    <form onSubmit={save} className={classes.form}>
      <Stack gap="lg">
        <Stack gap={4} className={classes.pageHeader}>
          <Text fw={600}>{t("ai.settings.title")}</Text>
          <Text size="sm" c="dimmed">
            {t("ai.settings.description")}
          </Text>
        </Stack>

        <Paper withBorder radius="md" p="md" className={classes.enableCard}>
          <Switch
            label={t("ai.settings.enable")}
            description={t("ai.settings.enableDescription")}
            {...form.getInputProps("enabled", { type: "checkbox" })}
          />
        </Paper>

        {statusQuery.data?.usage && (
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
                  clearApiKey ? setClearApiKey(false) : confirmClearKey("model")
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
                        label={t("ai.settings.temperature")}
                        description={t("ai.settings.temperatureDescription")}
                        min={0}
                        max={2}
                        step={0.1}
                        decimalScale={2}
                        {...form.getInputProps("temperature")}
                      />
                      <NumberInput
                        label={t("ai.settings.maxOutputTokens")}
                        description={t(
                          "ai.settings.maxOutputTokensDescription",
                        )}
                        min={1}
                        max={131072}
                        {...form.getInputProps("maxOutputTokens")}
                      />
                      <NumberInput
                        label={t("ai.settings.contextWindow")}
                        description={t("ai.settings.contextWindowDescription")}
                        min={1024}
                        max={2000000}
                        {...form.getInputProps("contextWindow")}
                      />
                      <NumberInput
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
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>

            {modelTestResult && (
              <Alert
                color={modelTestResult.ok ? "green" : "red"}
                icon={modelTestResult.ok ? <IconCheck size={17} /> : undefined}
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
                        {...form.getInputProps(`quickCommands.${index}.label`)}
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
                <TextInput
                  label={t("ai.settings.retrievalUrl")}
                  description={t("ai.settings.retrievalUrlDescription")}
                  placeholder="https://rag.example.com/query"
                  required
                  {...form.getInputProps("retrievalUrl")}
                />
                <PasswordInput
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
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <NumberInput
                    label={t("ai.settings.retrievalTimeout")}
                    description={t("ai.settings.retrievalTimeoutDescription")}
                    min={1000}
                    max={60000}
                    {...form.getInputProps("retrievalTimeoutMs")}
                  />
                  <NumberInput
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
                    color={retrievalTestResult.ok ? "green" : "red"}
                    py="xs"
                  >
                    {"errorMessage" in retrievalTestResult
                      ? retrievalTestResult.errorMessage
                      : retrievalTestResult.ok
                        ? t("ai.settings.retrievalTestSucceeded")
                        : t("ai.settings.retrievalTestFailed")}
                  </Alert>
                )}
              </Stack>
            )}
          </Stack>
        </SettingsSection>

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
                  label={t("ai.settings.userDailyLimit")}
                  description={t("ai.settings.userDailyLimitDescription")}
                  min={1}
                  max={100000}
                  {...form.getInputProps("dailyRequestLimitPerUser")}
                />
                <NumberInput
                  label={t("ai.settings.spaceTokenLimit")}
                  description={t("ai.settings.spaceTokenLimitDescription")}
                  min={1}
                  max={1000000000}
                  {...form.getInputProps("dailyTokenLimitPerSpace")}
                />
                <NumberInput
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

        <div className={classes.actionBar}>
          <Group justify="flex-end" className={classes.actionGroup}>
            <Button
              type="button"
              variant="default"
              leftSection={<IconPlayerPlay size={16} />}
              loading={testModel.isPending}
              onClick={() => void test()}
            >
              {t("ai.settings.test")}
            </Button>
            <Button type="submit" loading={updateConfig.isPending}>
              {t("ai.save")}
            </Button>
          </Group>
        </div>
      </Stack>
    </form>
  );
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
