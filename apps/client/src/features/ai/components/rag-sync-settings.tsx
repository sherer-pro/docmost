import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconDatabaseCog,
  IconKeyOff,
  IconPlayerPlay,
  IconRefresh,
  IconServerOff,
} from "@tabler/icons-react";
import type {
  RagSyncErrorCode,
  RagSyncHealthState,
  RagSyncSpaceConfig,
} from "@docmost/api-contract";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiSpaceConfigQuery } from "@/features/ai/queries/ai-query.ts";
import {
  useRagSyncActionMutation,
  useRagSyncSpaceConfigQuery,
  useTestRagSyncTargetMutation,
  useUpdateRagSyncSpaceConfigMutation,
} from "@/features/ai/queries/rag-sync-query.ts";
import type { RagSyncAction } from "@/features/ai/services/rag-sync-service.ts";
import classes from "./rag-sync-settings.module.css";

type RagSyncForm = {
  baseUrl: string;
  knowledgeId: string;
  writerApiKey: string;
};

const EMPTY_FORM: RagSyncForm = {
  baseUrl: "",
  knowledgeId: "",
  writerApiKey: "",
};

const HEALTH_COLORS: Record<RagSyncHealthState, string> = {
  disabled: "gray",
  idle: "gray",
  syncing: "blue",
  healthy: "green",
  degraded: "yellow",
  error: "red",
};

const ERROR_KEYS: Record<RagSyncErrorCode, string> = {
  rag_sync_deployment_disabled: "ai.ragSync.error.deploymentDisabled",
  rag_sync_not_configured: "ai.ragSync.error.notConfigured",
  rag_sync_target_in_use: "ai.ragSync.error.targetInUse",
  rag_sync_config_conflict: "ai.ragSync.error.configConflict",
  rag_sync_cleanup_required: "ai.ragSync.error.cleanupRequired",
  rag_sync_cleanup_in_progress: "ai.ragSync.error.cleanupInProgress",
  rag_sync_invalid_state: "ai.ragSync.error.invalidState",
  rag_sync_writer_unavailable: "ai.ragSync.error.writerUnavailable",
  rag_sync_writer_unauthorized: "ai.ragSync.error.writerUnauthorized",
  rag_sync_target_unavailable: "ai.ragSync.error.targetUnavailable",
  rag_sync_target_invalid: "ai.ragSync.error.targetUnavailable",
  rag_sync_target_timeout: "ai.ragSync.error.targetUnavailable",
  rag_sync_processing_timeout: "ai.ragSync.error.writerUnavailable",
  rag_sync_processing_failed: "ai.ragSync.error.writerUnavailable",
  rag_sync_invalid_response: "ai.ragSync.error.writerUnavailable",
  rag_sync_redirect_rejected: "ai.ragSync.error.targetUnavailable",
  rag_sync_source_too_large: "ai.ragSync.error.writerUnavailable",
  rag_sync_url_rejected: "ai.ragSync.error.targetUnavailable",
  rag_sync_writer_key_missing: "ai.ragSync.error.notConfigured",
  rag_sync_lease_lost: "ai.ragSync.error.unknown",
  rag_sync_aborted: "ai.ragSync.error.unknown",
  rag_sync_internal_error: "ai.ragSync.error.unknown",
  rag_sync_scope_unavailable: "ai.ragSync.error.unknown",
  rag_sync_invalid_feed: "ai.ragSync.error.unknown",
};

function isHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.replace(/\/+$/, "") === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function configIdentity(config: RagSyncSpaceConfig) {
  return [
    config.bindingId,
    config.configVersion,
    config.state,
    config.cleanupRequired,
    config.target.baseUrl,
    config.target.knowledgeId,
    config.target.writerApiKeyConfigured,
  ].join(":");
}

export function RagSyncSettings({
  spaceId,
  onDirtyChange,
}: {
  spaceId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const configQuery = useRagSyncSpaceConfigQuery(spaceId);
  const aiConfigQuery = useAiSpaceConfigQuery(spaceId);
  const updateConfig = useUpdateRagSyncSpaceConfigMutation(spaceId);
  const testTarget = useTestRagSyncTargetMutation(spaceId);
  const actionMutation = useRagSyncActionMutation(spaceId);
  const [clearWriterApiKey, setClearWriterApiKey] = useState(false);
  const initializedConfig = useRef<string | null>(null);
  const form = useForm<RagSyncForm>({
    initialValues: EMPTY_FORM,
    validate: {
      baseUrl: (value) =>
        isHttpOrigin(value) ? null : t("ai.ragSync.validation.baseUrl"),
      knowledgeId: (value) =>
        value.trim() ? null : t("ai.ragSync.validation.knowledgeId"),
    },
  });

  useEffect(() => {
    const config = configQuery.data;
    if (!config) return;
    const identity = configIdentity(config);
    if (initializedConfig.current === identity) return;
    if (
      initializedConfig.current !== null &&
      (form.isDirty() || clearWriterApiKey)
    ) {
      return;
    }
    form.setValues({
      baseUrl: config.target.baseUrl ?? "",
      knowledgeId: config.target.knowledgeId ?? "",
      writerApiKey: "",
    });
    form.resetDirty();
    setClearWriterApiKey(false);
    initializedConfig.current = identity;
  }, [clearWriterApiKey, configQuery.data, form]);

  useEffect(() => {
    onDirtyChange?.(form.isDirty() || clearWriterApiKey);
  }, [clearWriterApiKey, form.values, onDirtyChange]);

  const config = configQuery.data;
  const state = config?.state ?? "disabled";
  const canEditTarget = state === "disabled" && !config?.cleanupRequired;
  const canEditWriterKey = state !== "draining";
  const hasSavedTarget = Boolean(
    config?.target.baseUrl &&
      config.target.knowledgeId &&
      config.target.writerApiKeyConfigured,
  );
  const hasUnsavedChanges = form.isDirty() || clearWriterApiKey;
  const retrievalTarget = aiConfigQuery.data?.retrieval.openWebUi;
  const retrievalUsesOpenWebUi =
    aiConfigQuery.data?.retrieval.adapter === "open-webui-knowledge-v1";
  const targetMismatch =
    retrievalUsesOpenWebUi &&
    (normalizeOrigin(retrievalTarget?.baseUrl) !==
      normalizeOrigin(form.values.baseUrl) ||
      (retrievalTarget?.knowledgeId ?? "") !== form.values.knowledgeId.trim());
  const isBusy =
    updateConfig.isPending || testTarget.isPending || actionMutation.isPending;

  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : t("ai.ragSync.never");

  const resolveRequestError = (error: unknown) => {
    const code = (error as any)?.response?.data?.code as
      | RagSyncErrorCode
      | undefined;
    return code && ERROR_KEYS[code]
      ? t(ERROR_KEYS[code])
      : t("ai.ragSync.error.unknown");
  };

  const showRequestError = (error: unknown) => {
    notifications.show({ color: "red", message: resolveRequestError(error) });
  };

  const save = async () => {
    if (!config || form.validate().hasErrors) return;
    try {
      const next = await updateConfig.mutateAsync({
        expectedVersion: config.configVersion,
        target: {
          adapter: "open-webui-knowledge-v1",
          baseUrl: form.values.baseUrl.trim() || null,
          knowledgeId: form.values.knowledgeId.trim() || null,
          ...(form.values.writerApiKey.trim()
            ? { writerApiKey: form.values.writerApiKey.trim() }
            : {}),
          ...(clearWriterApiKey ? { clearWriterApiKey: true } : {}),
        },
      });
      form.setValues({
        baseUrl: next.target.baseUrl ?? "",
        knowledgeId: next.target.knowledgeId ?? "",
        writerApiKey: "",
      });
      form.resetDirty();
      setClearWriterApiKey(false);
      initializedConfig.current = configIdentity(next);
      onDirtyChange?.(false);
      notifications.show({ color: "green", message: t("ai.ragSync.saved") });
    } catch (error) {
      showRequestError(error);
    }
  };

  const runAction = async (action: RagSyncAction, successKey: string) => {
    if (config.configVersion === null) return;
    try {
      await actionMutation.mutateAsync({
        action,
        expectedVersion: config.configVersion,
      });
      notifications.show({ color: "green", message: t(successKey) });
    } catch (error) {
      showRequestError(error);
    }
  };

  const confirmAction = (
    action: RagSyncAction,
    titleKey: string,
    messageKey: string,
    successKey: string,
    danger = false,
  ) => {
    modals.openConfirmModal({
      title: t(titleKey),
      children: <Text size="sm">{t(messageKey)}</Text>,
      labels: {
        confirm: t("ai.ragSync.confirm"),
        cancel: t("ai.ragSync.cancel"),
      },
      confirmProps: danger ? { color: "red" } : undefined,
      onConfirm: () => void runAction(action, successKey),
    });
  };

  const confirmClearWriterKey = () => {
    modals.openConfirmModal({
      title: t("ai.ragSync.clearWriterKey"),
      children: <Text size="sm">{t("ai.ragSync.clearWriterKeyConfirm")}</Text>,
      labels: {
        confirm: t("ai.ragSync.clearWriterKey"),
        cancel: t("ai.ragSync.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: () => {
        setClearWriterApiKey(true);
        form.setFieldValue("writerApiKey", "");
      },
    });
  };

  if (configQuery.isLoading) {
    return (
      <Group justify="center" py="xl" role="status">
        <Loader size="sm" />
      </Group>
    );
  }

  if (configQuery.isError || !config) {
    return (
      <Alert color="red" title={t("ai.ragSync.loadFailed")}>
        {t("ai.ragSync.error.unknown")}
      </Alert>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Stack gap="lg">
        <Paper withBorder radius="md" p="lg" className={classes.section}>
          <Stack gap="md">
            <Group wrap="nowrap" align="flex-start">
              <ThemeIcon
                variant="light"
                color="teal"
                radius="md"
                className={classes.headerIcon}
              >
                <IconDatabaseCog size={18} />
              </ThemeIcon>
              <div>
                <Title order={2} size="h4">
                  {t("ai.ragSync.title")}
                </Title>
                <Text size="sm" c="dimmed">
                  {t("ai.ragSync.description")}
                </Text>
              </div>
            </Group>

            {!config.deploymentEnabled && (
              <Alert
                color="yellow"
                icon={<IconServerOff size={18} />}
                title={t("ai.ragSync.deploymentDisabled")}
              >
                {t("ai.ragSync.deploymentDisabledDescription")}
              </Alert>
            )}

            <Alert
              color="orange"
              icon={<IconAlertTriangle size={18} />}
              title={t("ai.ragSync.privacyTitle")}
            >
              {t("ai.ragSync.privacyDescription")}
            </Alert>

            {targetMismatch && (
              <Alert color="yellow" title={t("ai.ragSync.targetMismatchTitle")}>
                {t("ai.ragSync.targetMismatchDescription")}
              </Alert>
            )}

            {config.cleanupRequired && (
              <Alert color="red" title={t("ai.ragSync.cleanupRequiredTitle")}>
                {t("ai.ragSync.cleanupRequiredDescription")}
              </Alert>
            )}

            <div className={classes.statusGrid}>
              <Paper
                withBorder
                radius="md"
                p="sm"
                className={classes.statusCard}
              >
                <Text size="xs" c="dimmed">
                  {t("ai.ragSync.bindingState")}
                </Text>
                <Badge mt={4} variant="light">
                  {t(`ai.ragSync.state.${state}`)}
                </Badge>
              </Paper>
              <Paper
                withBorder
                radius="md"
                p="sm"
                className={classes.statusCard}
              >
                <Text size="xs" c="dimmed">
                  {t("ai.ragSync.health")}
                </Text>
                <Badge
                  mt={4}
                  variant="light"
                  color={HEALTH_COLORS[config.status.health]}
                >
                  {t(`ai.ragSync.healthState.${config.status.health}`)}
                </Badge>
              </Paper>
              <Paper
                withBorder
                radius="md"
                p="sm"
                className={classes.statusCard}
              >
                <Text size="xs" c="dimmed">
                  {t("ai.ragSync.lastAttempt")}
                </Text>
                <Text size="sm" fw={500} mt={4} truncate="end">
                  {formatDate(config.status.lastAttemptAt)}
                </Text>
              </Paper>
              <Paper
                withBorder
                radius="md"
                p="sm"
                className={classes.statusCard}
              >
                <Text size="xs" c="dimmed">
                  {t("ai.ragSync.lastSuccess")}
                </Text>
                <Text size="sm" fw={500} mt={4} truncate="end">
                  {formatDate(config.status.lastSuccessAt)}
                </Text>
              </Paper>
              <Paper
                withBorder
                radius="md"
                p="sm"
                className={classes.statusCard}
              >
                <Text size="xs" c="dimmed">
                  {t("ai.ragSync.lag")}
                </Text>
                <Text size="sm" fw={500} mt={4}>
                  {config.status.lagMs === null
                    ? t("ai.ragSync.never")
                    : t("ai.ragSync.lagValue", {
                        seconds: Math.ceil(config.status.lagMs / 1000),
                      })}
                </Text>
              </Paper>
            </div>

            {config.status.errorCode && (
              <Alert color="red" title={t("ai.ragSync.lastError")}>
                {t(ERROR_KEYS[config.status.errorCode])}
              </Alert>
            )}

            <TextInput
              label={t("ai.ragSync.baseUrl")}
              description={t("ai.ragSync.baseUrlDescription")}
              placeholder="https://open-webui.example.com"
              required
              disabled={!canEditTarget}
              {...form.getInputProps("baseUrl")}
            />
            <TextInput
              label={t("ai.ragSync.knowledgeId")}
              description={t("ai.ragSync.knowledgeIdDescription")}
              required
              disabled={!canEditTarget}
              {...form.getInputProps("knowledgeId")}
            />
            <PasswordInput
              visibilityToggleButtonProps={{
                "aria-label": t("ai.ux.toggleSecretVisibility"),
                style: { minWidth: 32, minHeight: 32 },
              }}
              label={t("ai.ragSync.writerApiKey")}
              description={
                clearWriterApiKey
                  ? t("ai.ragSync.writerKeyWillBeCleared")
                  : config.target.writerApiKeyConfigured
                    ? t("ai.ragSync.writerKeyConfigured")
                    : t("ai.ragSync.writerKeyRequired")
              }
              placeholder={
                config.target.writerApiKeyConfigured
                  ? t("ai.ragSync.writerKeyRotatePlaceholder")
                  : undefined
              }
              disabled={!canEditWriterKey || clearWriterApiKey}
              {...form.getInputProps("writerApiKey")}
            />
            {config.target.writerApiKeyConfigured && canEditTarget && (
              <Button
                type="button"
                variant={clearWriterApiKey ? "filled" : "subtle"}
                color={clearWriterApiKey ? "red" : "gray"}
                size="xs"
                leftSection={<IconKeyOff size={15} />}
                className={classes.keyAction}
                onClick={() =>
                  clearWriterApiKey
                    ? setClearWriterApiKey(false)
                    : confirmClearWriterKey()
                }
              >
                {clearWriterApiKey
                  ? t("ai.ragSync.keepWriterKey")
                  : t("ai.ragSync.clearWriterKey")}
              </Button>
            )}
          </Stack>
        </Paper>

        <div className={classes.actionBar}>
          <Group justify="flex-end" className={classes.actions}>
            <Button
              type="button"
              variant="default"
              leftSection={<IconPlayerPlay size={16} />}
              loading={testTarget.isPending}
              disabled={
                isBusy ||
                !config.deploymentEnabled ||
                !hasSavedTarget ||
                hasUnsavedChanges ||
                state !== "disabled" ||
                config.cleanupRequired
              }
              onClick={() =>
                void testTarget
                  .mutateAsync()
                  .then((result) =>
                    notifications.show({
                      color: "green",
                      message: t("ai.ragSync.testSucceeded", {
                        latency: result.latencyMs,
                      }),
                    }),
                  )
                  .catch(showRequestError)
              }
            >
              {t("ai.ragSync.test")}
            </Button>

            {state === "disabled" && config.cleanupRequired && (
              <>
                <Button
                  type="button"
                  variant="default"
                  leftSection={<IconRefresh size={16} />}
                  disabled={isBusy || !config.deploymentEnabled}
                  onClick={() =>
                    void runAction("retry-cleanup", "ai.ragSync.cleanupStarted")
                  }
                >
                  {t("ai.ragSync.retryCleanup")}
                </Button>
                <Button
                  type="button"
                  variant="light"
                  color="red"
                  disabled={isBusy}
                  onClick={() =>
                    confirmAction(
                      "abandon-cleanup",
                      "ai.ragSync.abandonCleanup",
                      "ai.ragSync.abandonCleanupConfirm",
                      "ai.ragSync.cleanupAbandoned",
                      true,
                    )
                  }
                >
                  {t("ai.ragSync.abandonCleanup")}
                </Button>
              </>
            )}

            {state === "disabled" && !config.cleanupRequired && (
              <Button
                type="button"
                color="teal"
                disabled={
                  isBusy ||
                  !config.deploymentEnabled ||
                  !hasSavedTarget ||
                  hasUnsavedChanges
                }
                onClick={() =>
                  void runAction("enable", "ai.ragSync.enabledNotification")
                }
              >
                {t("ai.ragSync.enable")}
              </Button>
            )}

            {state === "enabled" && (
              <Button
                type="button"
                variant="light"
                color="orange"
                disabled={isBusy || hasUnsavedChanges}
                onClick={() =>
                  confirmAction(
                    "disable",
                    "ai.ragSync.disable",
                    "ai.ragSync.disableConfirm",
                    "ai.ragSync.cleanupStarted",
                  )
                }
              >
                {t("ai.ragSync.disable")}
              </Button>
            )}

            {(state === "enabled" || state === "draining") && (
              <Button
                type="button"
                variant="light"
                color="red"
                disabled={isBusy}
                onClick={() =>
                  confirmAction(
                    "force-disable",
                    "ai.ragSync.forceDisable",
                    "ai.ragSync.forceDisableConfirm",
                    "ai.ragSync.forceDisabledNotification",
                    true,
                  )
                }
              >
                {t("ai.ragSync.forceDisable")}
              </Button>
            )}

            <Button
              type="submit"
              loading={updateConfig.isPending}
              disabled={isBusy || !hasUnsavedChanges || state === "draining"}
            >
              {t("ai.save")}
            </Button>
          </Group>
        </div>
      </Stack>
    </form>
  );
}
