import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  Radio,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconTrash } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { useUserRole } from "@/hooks/use-user-role.tsx";
import {
  useAiExternalMcpBindingsQuery,
  useDeleteAiExternalMcpBindingMutation,
  usePutAiExternalMcpBindingMutation,
} from "@/features/ai-external-mcp/queries/ai-external-mcp-query.ts";
import type {
  AiExternalMcpBinding,
  AiExternalMcpToolSelectionMode,
} from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

const INSTRUCTIONS_MAX_LENGTH = 2000;

type Props = { spaceId: string };

/**
 * Space-level configuration.
 *
 * A space administrator may only pick from the workspace catalog, narrow the
 * approved tool set, and add prompt hints. Nothing here can widen what the
 * workspace approved.
 */
export default function AiSpaceExternalMcpSettings({ spaceId }: Props) {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const bindingsQuery = useAiExternalMcpBindingsQuery(spaceId);
  const putBinding = usePutAiExternalMcpBindingMutation(spaceId);
  const deleteBinding = useDeleteAiExternalMcpBindingMutation(spaceId);

  const [instructionDrafts, setInstructionDrafts] = useState<
    Record<string, string>
  >({});

  const view = bindingsQuery.data;

  const save = async (
    binding: AiExternalMcpBinding,
    patch: {
      enabled?: boolean;
      toolSelection?: AiExternalMcpToolSelectionMode;
      toolNames?: string[];
      instructions?: string | null;
    },
  ) => {
    try {
      await putBinding.mutateAsync({
        serverId: binding.serverId,
        data: {
          enabled: patch.enabled ?? binding.enabled,
          toolSelection: patch.toolSelection ?? binding.toolSelection,
          toolNames: patch.toolNames ?? binding.toolNames,
          instructions:
            patch.instructions !== undefined
              ? patch.instructions
              : binding.instructions,
        },
      });
    } catch (error) {
      notifications.show({
        color: "red",
        message:
          (error as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ?? t("ai.externalTools.saveFailed"),
      });
      void bindingsQuery.refetch();
    }
  };

  if (bindingsQuery.isLoading) {
    return (
      <Group justify="center" py="xl" role="status">
        <Loader size="sm" />
      </Group>
    );
  }

  if (bindingsQuery.isError || !view) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
        {t("ai.loadFailed")}
      </Alert>
    );
  }

  const gateClosed = !view.deploymentEnabled || !view.workspaceEnabled;

  return (
    <Stack gap="md">
      <div>
        <Title order={3} size="h4">
          {t("ai.externalTools.spaceTitle")}
        </Title>
        <Text size="sm" c="dimmed">
          {t("ai.externalTools.spaceDescription")}
        </Text>
      </div>

      {gateClosed && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
        >
          <Stack gap="sm" align="flex-start">
            <Text size="sm">
              {!view.deploymentEnabled
                ? t("ai.externalTools.unavailableDeployment")
                : t("ai.externalTools.unavailableWorkspace")}
            </Text>
            {/* Only a workspace admin can act on this, so only they get a link. */}
            {isAdmin && view.deploymentEnabled && (
              <Button
                component={Link}
                to="/settings/ai/external-tools"
                variant="light"
                size="compact-sm"
              >
                {t("ai.externalTools.manageCatalog")}
              </Button>
            )}
          </Stack>
        </Alert>
      )}

      {view.catalog.length > 0 && (
        <Select
          label={t("ai.externalTools.spaceAddServer")}
          placeholder={t("ai.externalTools.spaceAddServer")}
          data={view.catalog.map((entry) => ({
            value: entry.serverId,
            label: entry.name,
          }))}
          value={null}
          onChange={(serverId) => {
            if (!serverId) {
              return;
            }
            void putBinding.mutateAsync({
              serverId,
              data: { enabled: true, toolSelection: "all", toolNames: [] },
            });
          }}
          disabled={gateClosed || putBinding.isPending}
        />
      )}

      {view.bindings.length === 0 ? (
        <EmptyState
          icon={IconAlertTriangle}
          title={t("ai.externalTools.spaceEmptyTitle")}
          description={t("ai.externalTools.spaceEmptyDescription")}
          compact
        />
      ) : (
        <Stack gap="sm">
          {view.bindings.map((binding) => {
            const draftInstructions =
              instructionDrafts[binding.serverId] ?? binding.instructions ?? "";

            return (
              <Paper key={binding.serverId} withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Switch
                      checked={binding.enabled}
                      onChange={(event) =>
                        void save(binding, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                      label={binding.serverName}
                      description={t("ai.externalTools.optInToolCount", {
                        count: binding.availableTools.length,
                      })}
                      disabled={gateClosed || putBinding.isPending}
                    />
                    <Group gap="xs">
                      {!binding.serverEnabled && (
                        <Badge color="gray" variant="light" size="xs">
                          {t("ai.externalTools.serverDisabledBadge")}
                        </Badge>
                      )}
                      {binding.deniedByGroup && (
                        <Badge color="red" variant="light" size="xs">
                          {t("ai.externalTools.groupDeniedBadge")}
                        </Badge>
                      )}
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-xs"
                        leftSection={<IconTrash size={13} />}
                        onClick={() =>
                          modals.openConfirmModal({
                            title: t("ai.externalTools.removeBinding"),
                            children: (
                              <Text size="sm">
                                {t("ai.externalTools.removeBindingConfirm")}
                              </Text>
                            ),
                            labels: {
                              confirm: t("ai.externalTools.removeBinding"),
                              cancel: t("Cancel"),
                            },
                            confirmProps: { color: "red" },
                            onConfirm: () =>
                              deleteBinding.mutate(binding.serverId),
                          })
                        }
                      >
                        {t("Remove")}
                      </Button>
                    </Group>
                  </Group>

                  <Radio.Group
                    label={t("ai.externalTools.toolSelection")}
                    value={binding.toolSelection}
                    onChange={(value) =>
                      void save(binding, {
                        toolSelection: value as AiExternalMcpToolSelectionMode,
                        toolNames:
                          value === "all"
                            ? []
                            : binding.availableTools.map((tool) => tool.toolName),
                      })
                    }
                  >
                    <Group gap="md" mt={6}>
                      <Radio
                        value="all"
                        label={t("ai.externalTools.toolSelectionAll")}
                        disabled={!binding.enabled || gateClosed}
                      />
                      <Radio
                        value="selected"
                        label={t("ai.externalTools.toolSelectionSelected")}
                        disabled={!binding.enabled || gateClosed}
                      />
                    </Group>
                  </Radio.Group>

                  {binding.toolSelection === "selected" && (
                    <Checkbox.Group
                      value={binding.toolNames}
                      onChange={(value) => {
                        if (value.length === 0) {
                          notifications.show({
                            color: "red",
                            message: t("ai.externalTools.toolSelectionEmpty"),
                          });
                          return;
                        }
                        void save(binding, { toolNames: value });
                      }}
                    >
                      <Stack gap={6} mt={6}>
                        {binding.availableTools.map((tool) => (
                          <Checkbox
                            key={tool.toolName}
                            value={tool.toolName}
                            disabled={!binding.enabled || gateClosed}
                            label={
                              <Stack gap={0}>
                                <Text size="sm" ff="monospace">
                                  {tool.toolName}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {tool.description}
                                </Text>
                              </Stack>
                            }
                          />
                        ))}
                      </Stack>
                    </Checkbox.Group>
                  )}

                  <Textarea
                    label={t("ai.externalTools.instructions")}
                    description={t("ai.externalTools.instructionsDescription")}
                    value={draftInstructions}
                    onChange={(event) =>
                      setInstructionDrafts((current) => ({
                        ...current,
                        [binding.serverId]: event.currentTarget.value,
                      }))
                    }
                    onBlur={() => {
                      if (draftInstructions !== (binding.instructions ?? "")) {
                        void save(binding, {
                          instructions: draftInstructions.trim() || null,
                        });
                      }
                    }}
                    maxLength={INSTRUCTIONS_MAX_LENGTH}
                    autosize
                    minRows={2}
                    disabled={!binding.enabled || gateClosed}
                  />
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
