import {
  Alert,
  Button,
  Divider,
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
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  IconCheck,
  IconArrowDown,
  IconArrowUp,
  IconKeyOff,
  IconPlus,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
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
  dailyRequestLimitPerUser:
    AI_SPACE_CONFIG_DEFAULTS.dailyRequestLimitPerUser,
  dailyTokenLimitPerSpace:
    AI_SPACE_CONFIG_DEFAULTS.dailyTokenLimitPerSpace,
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
  const { t } = useTranslation();
  const configQuery = useAiSpaceConfigQuery(spaceId);
  const statusQuery = useAiSpaceStatusQuery(spaceId);
  const updateConfig = useUpdateAiSpaceConfigMutation(spaceId);
  const testModel = useTestAiModelConfigMutation(spaceId);
  const testRetrieval = useTestAiRetrievalConfigMutation(spaceId);
  const [modelTestResult, setModelTestResult] =
    useState<AiModelTestResult | { ok: false; errorMessage: string } | null>(
      null,
    );
  const [retrievalTestResult, setRetrievalTestResult] =
    useState<
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
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
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
        message:
          error?.["response"]?.data?.message ?? t("ai.settings.saveFailed"),
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
        errorMessage:
          error?.["response"]?.data?.message ?? t("ai.settings.testFailed"),
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
        errorMessage:
          error?.["response"]?.data?.message ??
          t("ai.settings.retrievalTestFailed"),
      });
    }
  };

  if (configQuery.isLoading) {
    return <Text size="sm">{t("Loading...")}</Text>;
  }

  if (configQuery.isError) {
    return (
      <Alert color="red" title={t("ai.settings.loadFailed")}>
        {t("ai.settings.adminOnly")}
      </Alert>
    );
  }

  return (
    <form onSubmit={save}>
      <Stack gap="md" pb="xl">
        <Stack gap={4}>
          <Text fw={600}>{t("ai.settings.title")}</Text>
          <Text size="sm" c="dimmed">
            {t("ai.settings.description")}
          </Text>
        </Stack>

        <Switch
          label={t("ai.settings.enable")}
          description={t("ai.settings.enableDescription")}
          {...form.getInputProps("enabled", { type: "checkbox" })}
        />

        {statusQuery.data?.usage && (
          <>
            <Divider
              label={t("ai.settings.usageSection")}
              labelPosition="left"
            />
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
          </>
        )}

        <Divider label={t("ai.settings.modelSection")} labelPosition="left" />

        <TextInput
          label={t("ai.settings.baseUrl")}
          placeholder="http://127.0.0.1:56254/v1"
          required
          {...form.getInputProps("baseUrl")}
        />
        <TextInput
          label={t("ai.settings.chatModel")}
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
            onClick={() =>
              clearApiKey ? setClearApiKey(false) : confirmClearKey("model")
            }
          >
            {clearApiKey
              ? t("ai.settings.keepApiKey")
              : t("ai.settings.clearApiKey")}
          </Button>
        )}

        <Group grow align="flex-start">
          <NumberInput
            label={t("ai.settings.temperature")}
            min={0}
            max={2}
            step={0.1}
            decimalScale={2}
            {...form.getInputProps("temperature")}
          />
          <NumberInput
            label={t("ai.settings.maxOutputTokens")}
            min={1}
            max={131072}
            {...form.getInputProps("maxOutputTokens")}
          />
        </Group>
        <Group grow align="flex-start">
          <NumberInput
            label={t("ai.settings.contextWindow")}
            min={1024}
            max={2000000}
            {...form.getInputProps("contextWindow")}
          />
          <NumberInput
            label={t("ai.settings.timeout")}
            description={t("ai.settings.milliseconds")}
            min={1000}
            max={600000}
            {...form.getInputProps("requestTimeoutMs")}
          />
        </Group>
        <Switch
          label={t("ai.settings.vision")}
          {...form.getInputProps("visionEnabled", { type: "checkbox" })}
        />

        <Divider
          label={t("ai.settings.retrievalSection")}
          labelPosition="left"
        />
        <Text size="sm" c="dimmed">
          {t("ai.settings.retrievalDescription")}
        </Text>
        <Switch
          label={t("ai.settings.enableRetrieval")}
          description={t("ai.settings.retrievalFallback")}
          {...form.getInputProps("retrievalEnabled", { type: "checkbox" })}
        />
        {form.values.retrievalEnabled && (
          <>
            <TextInput
              label={t("ai.settings.retrievalUrl")}
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
            <Group grow align="flex-start">
              <NumberInput
                label={t("ai.settings.retrievalTimeout")}
                min={1000}
                max={60000}
                {...form.getInputProps("retrievalTimeoutMs")}
              />
              <NumberInput
                label={t("ai.settings.retrievalMaxResults")}
                min={1}
                max={20}
                {...form.getInputProps("retrievalMaxResults")}
              />
            </Group>
            <Button
              type="button"
              variant="default"
              leftSection={<IconPlayerPlay size={16} />}
              loading={testRetrieval.isPending}
              onClick={() => void testRetrievalConnection()}
            >
              {t("ai.settings.testRetrieval")}
            </Button>
            {retrievalTestResult && (
              <Alert color={retrievalTestResult.ok ? "green" : "red"} py="xs">
                {"errorMessage" in retrievalTestResult
                  ? retrievalTestResult.errorMessage
                  : retrievalTestResult.ok
                    ? t("ai.settings.retrievalTestSucceeded")
                    : t("ai.settings.retrievalTestFailed")}
              </Alert>
            )}
          </>
        )}

        <Divider
          label={t("ai.settings.behaviorSection")}
          labelPosition="left"
        />
        <Textarea
          label={t("ai.settings.systemInstructions")}
          minRows={3}
          maxRows={8}
          autosize
          {...form.getInputProps("systemInstructions")}
        />
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              {t("ai.settings.quickCommands")}
            </Text>
            <Button
              type="button"
              size="compact-xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                form.insertListItem("quickCommands", {
                  id: crypto.randomUUID(),
                  label: "",
                  prompt: "",
                  enabled: true,
                  position: form.values.quickCommands.length,
                })
              }
            >
              {t("ai.settings.addCommand")}
            </Button>
          </Group>
          {form.values.quickCommands.map((command, index) => (
            <Stack
              key={command.id}
              gap={6}
              p="xs"
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-sm)",
              }}
            >
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  label={t("ai.settings.commandLabel")}
                  flex={1}
                  maxLength={120}
                  {...form.getInputProps(`quickCommands.${index}.label`)}
                />
                <Switch
                  label={t("Enabled")}
                  {...form.getInputProps(`quickCommands.${index}.enabled`, {
                    type: "checkbox",
                  })}
                />
                <Button
                  type="button"
                  variant="subtle"
                  px={5}
                  aria-label={t("ai.settings.moveCommandUp")}
                  disabled={index === 0}
                  onClick={() =>
                    form.reorderListItem("quickCommands", {
                      from: index,
                      to: index - 1,
                    })
                  }
                >
                  <IconArrowUp size={15} />
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  px={5}
                  aria-label={t("ai.settings.moveCommandDown")}
                  disabled={index === form.values.quickCommands.length - 1}
                  onClick={() =>
                    form.reorderListItem("quickCommands", {
                      from: index,
                      to: index + 1,
                    })
                  }
                >
                  <IconArrowDown size={15} />
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  color="red"
                  px={6}
                  aria-label={t("ai.settings.deleteCommand")}
                  onClick={() => form.removeListItem("quickCommands", index)}
                >
                  <IconTrash size={16} />
                </Button>
              </Group>
              <Textarea
                label={t("ai.settings.commandPrompt")}
                minRows={2}
                maxRows={5}
                autosize
                maxLength={4000}
                {...form.getInputProps(`quickCommands.${index}.prompt`)}
              />
            </Stack>
          ))}
        </Stack>
        <Group grow align="flex-start">
          <NumberInput
            label={t("ai.settings.userDailyLimit")}
            min={1}
            max={100000}
            {...form.getInputProps("dailyRequestLimitPerUser")}
          />
          <NumberInput
            label={t("ai.settings.spaceTokenLimit")}
            min={1}
            max={1000000000}
            {...form.getInputProps("dailyTokenLimitPerSpace")}
          />
        </Group>
        <NumberInput
          label={t("ai.settings.retentionDays")}
          min={1}
          max={365}
          {...form.getInputProps("retentionDays")}
        />

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

        <Group justify="flex-end">
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
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value.toLocaleString()}</Text>
    </Paper>
  );
}
