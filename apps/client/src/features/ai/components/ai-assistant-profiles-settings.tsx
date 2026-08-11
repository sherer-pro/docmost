import {
  AI_ASSISTANT_PROFILE_ICONS,
  AI_ASSISTANT_PROFILE_LIMITS,
  type AiAssistantProfile,
  type AiAssistantProfileGroupPolicy,
  type AiAssistantProfileIcon,
  type AiBuiltinToolCapability,
  type AiQuickCommand,
} from "@docmost/api-contract";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconRobot,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAiAssistantProfilePolicyQuery,
  useAiAssistantProfileQuery,
  useAiAssistantProfilesQuery,
  useCreateAiAssistantProfileMutation,
  useDeleteAiAssistantProfileMutation,
  useTestAiAssistantProfileAgentMutation,
  useTestAiAssistantProfileModelMutation,
  useUpdateAiAssistantProfileMutation,
  useUpdateAiAssistantProfilePolicyMutation,
  useUpdateAiSpaceConfigMutation,
} from "@/features/ai/queries/ai-query.ts";
import { useAiBuiltinToolSpacePolicyQuery } from "@/features/ai/queries/ai-tool-policy-query.ts";
import { useAiExternalMcpBindingsQuery } from "@/features/ai-external-mcp/queries/ai-external-mcp-query.ts";
import { useGetGroupsQuery } from "@/features/group/queries/group-query.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import {
  buildAiAssistantProfileCapabilityOptions,
  normalizeAiAssistantProfileQuickCommands,
} from "@/features/ai/utils/ai-assistant-profile-form.ts";

type ProfileForm = {
  name: string;
  description: string;
  icon: AiAssistantProfileIcon;
  instructions: string;
  enabled: boolean;
  inheritQuickCommands: boolean;
  quickCommands: AiQuickCommand[];
  chatModelOverride: string;
  temperatureOverride: number | "";
  maxOutputTokensOverride: number | "";
  allowedBuiltinCapabilities: AiBuiltinToolCapability[];
  allowedExternalTools: string[];
  groupPolicies: AiAssistantProfileGroupPolicy[];
  autoStart: boolean;
  launchMessage: string;
};

const EMPTY_FORM: ProfileForm = {
  name: "",
  description: "",
  icon: "sparkles",
  instructions: "",
  enabled: false,
  inheritQuickCommands: true,
  quickCommands: [],
  chatModelOverride: "",
  temperatureOverride: "",
  maxOutputTokensOverride: "",
  allowedBuiltinCapabilities: [],
  allowedExternalTools: [],
  groupPolicies: [],
  autoStart: false,
  launchMessage: "",
};

export function AiAssistantProfilesSettings({
  spaceId,
  canManageWorkspacePolicy,
}: {
  spaceId: string;
  canManageWorkspacePolicy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const policyQuery = useAiAssistantProfilePolicyQuery(
    canManageWorkspacePolicy,
  );
  const profilesQuery = useAiAssistantProfilesQuery(spaceId);
  const toolsQuery = useAiBuiltinToolSpacePolicyQuery(spaceId);
  const externalQuery = useAiExternalMcpBindingsQuery(spaceId);
  const groupsQuery = useGetGroupsQuery({ limit: 100 });
  const updatePolicy = useUpdateAiAssistantProfilePolicyMutation();
  const updateConfig = useUpdateAiSpaceConfigMutation(spaceId);
  const createProfile = useCreateAiAssistantProfileMutation(spaceId);
  const updateProfile = useUpdateAiAssistantProfileMutation(spaceId);
  const deleteProfile = useDeleteAiAssistantProfileMutation(spaceId);
  const testModel = useTestAiAssistantProfileModelMutation(spaceId);
  const testAgent = useTestAiAssistantProfileAgentMutation(spaceId);
  const [opened, setOpened] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const detailQuery = useAiAssistantProfileQuery(spaceId, editingId);
  const form = useForm<ProfileForm>({ initialValues: EMPTY_FORM });

  const externalOptions = useMemo(
    () =>
      (externalQuery.data?.bindings ?? []).flatMap((binding) =>
        binding.availableTools.map((tool) => ({
          value: `${binding.bindingId}::${tool.toolName}`,
          label: `${binding.serverName} / ${tool.toolName}`,
        })),
      ),
    [externalQuery.data],
  );
  const groupOptions = (groupsQuery.data?.items ?? []).map((group) => ({
    value: group.id,
    label: group.name,
  }));
  const capabilityOptions = buildAiAssistantProfileCapabilityOptions(
    toolsQuery.data?.catalog ?? [],
    toolsQuery.data?.effectiveCapabilities ?? [],
    (toolName) => t(`ai.toolPolicy.tool.${toolName}`),
  );

  useEffect(() => {
    const profile = detailQuery.data;
    if (!profile || profile.id !== editingId) return;
    form.setValues(toForm(profile));
    form.resetDirty(toForm(profile));
  }, [detailQuery.data, editingId]);

  const openCreate = () => {
    setEditingId(undefined);
    form.setValues({
      ...EMPTY_FORM,
      allowedBuiltinCapabilities: toolsQuery.data?.effectiveCapabilities ?? [],
    });
    form.resetDirty();
    setOpened(true);
  };

  const openEdit = (profileId: string) => {
    setEditingId(profileId);
    setOpened(true);
  };

  const showError = (error: any) =>
    notifications.show({
      color: "red",
      message: error?.response?.data?.code
        ? resolveAiErrorMessage(t, i18n, error.response.data.code)
        : t("ai.profiles.saveFailed"),
    });

  const save = async () => {
    const values = form.values;
    if (!values.name.trim() || !values.instructions.trim()) {
      notifications.show({ color: "red", message: t("ai.profiles.required") });
      return;
    }
    if (values.autoStart && !values.launchMessage.trim()) {
      notifications.show({
        color: "red",
        message: t("ai.profiles.launchRequired"),
      });
      return;
    }
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      icon: values.icon,
      instructions: values.instructions.trim(),
      enabled: values.enabled,
      quickCommands: values.inheritQuickCommands
        ? null
        : normalizeAiAssistantProfileQuickCommands(values.quickCommands),
      chatModelOverride: values.chatModelOverride.trim() || null,
      temperatureOverride:
        values.temperatureOverride === "" ? null : values.temperatureOverride,
      maxOutputTokensOverride:
        values.maxOutputTokensOverride === ""
          ? null
          : values.maxOutputTokensOverride,
      allowedBuiltinCapabilities: values.allowedBuiltinCapabilities,
      allowedExternalTools: values.allowedExternalTools.map((selection) => {
        const [bindingId, toolName] = selection.split("::", 2);
        return { bindingId, toolName };
      }),
      groupPolicies: values.groupPolicies,
      autoStart: values.autoStart,
      launchMessage: values.launchMessage.trim() || null,
    };
    try {
      if (editingId && detailQuery.data) {
        await updateProfile.mutateAsync({
          profileId: editingId,
          data: { ...payload, expectedVersion: detailQuery.data.version },
        });
      } else {
        await createProfile.mutateAsync(payload);
      }
      notifications.show({ color: "green", message: t("ai.profiles.saved") });
      setOpened(false);
    } catch (error) {
      showError(error);
    }
  };

  if (profilesQuery.isLoading || policyQuery.isLoading)
    return <Loader size="sm" />;
  if (!profilesQuery.data) {
    return <Alert color="red">{t("ai.profiles.loadFailed")}</Alert>;
  }

  return (
    <Stack gap="lg">
      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <div>
            <Group gap="xs">
              <IconSparkles size={18} />
              <Text fw={600}>{t("ai.profiles.title")}</Text>
            </Group>
            <Text size="sm" c="dimmed">
              {t("ai.profiles.description")}
            </Text>
          </div>
          {policyQuery.data ? (
            <>
              {!policyQuery.data.deploymentEnabled && (
                <Alert color="yellow">
                  {t("ai.profiles.deploymentDisabled")}
                </Alert>
              )}
              <Switch
                label={t("ai.profiles.workspaceEnabled")}
                checked={policyQuery.data.enabled}
                disabled={
                  !policyQuery.data.deploymentEnabled || updatePolicy.isPending
                }
                onChange={(event) =>
                  void updatePolicy
                    .mutateAsync({ enabled: event.currentTarget.checked })
                    .catch(showError)
                }
              />
              <Switch
                label={t("ai.profiles.modelOverridesEnabled")}
                checked={policyQuery.data.modelOverridesEnabled}
                disabled={
                  !policyQuery.data.deploymentEnabled || updatePolicy.isPending
                }
                onChange={(event) =>
                  void updatePolicy
                    .mutateAsync({
                      modelOverridesEnabled: event.currentTarget.checked,
                    })
                    .catch(showError)
                }
              />
            </>
          ) : (
            <Alert color="yellow">
              {t("ai.profiles.workspaceAdminRequired")}
            </Alert>
          )}
          <Select
            label={t("ai.profiles.defaultProfile")}
            data={profilesQuery.data.items
              .filter((profile) => profile.enabled)
              .map((profile) => ({ value: profile.id, label: profile.name }))}
            value={profilesQuery.data.defaultProfileId}
            clearable
            searchable
            onChange={(defaultAssistantProfileId) =>
              void updateConfig
                .mutateAsync({ defaultAssistantProfileId })
                .then(() => profilesQuery.refetch())
                .catch(showError)
            }
          />
        </Stack>
      </Paper>

      <Group justify="space-between">
        <Text fw={600}>{t("ai.profiles.listTitle")}</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          {t("ai.profiles.create")}
        </Button>
      </Group>
      {profilesQuery.data.items.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Stack align="center">
            <IconRobot size={32} />
            <Text c="dimmed">{t("ai.profiles.empty")}</Text>
          </Stack>
        </Paper>
      ) : (
        profilesQuery.data.items.map((profile) => (
          <Paper key={profile.id} withBorder p="md" radius="md">
            <Group justify="space-between" align="flex-start">
              <div>
                <Group gap="xs">
                  <Text fw={600}>{profile.name}</Text>
                  <Badge variant="light">v{profile.version}</Badge>
                  {!profile.enabled && (
                    <Badge color="gray">{t("ai.profiles.disabled")}</Badge>
                  )}
                  <Badge color={profile.agent.available ? "green" : "yellow"}>
                    {t(`ai.profiles.agentReason.${profile.agent.reason}`)}
                  </Badge>
                </Group>
                {profile.description && (
                  <Text size="sm" c="dimmed">
                    {profile.description}
                  </Text>
                )}
              </div>
              <Group gap="xs">
                <Button
                  variant="default"
                  size="compact-sm"
                  onClick={() => openEdit(profile.id)}
                >
                  {t("Edit")}
                </Button>
                <Button
                  color="red"
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconTrash size={14} />}
                  onClick={() =>
                    modals.openConfirmModal({
                      title: t("ai.profiles.deleteTitle"),
                      children: (
                        <Text size="sm">
                          {t("ai.profiles.deleteDescription")}
                        </Text>
                      ),
                      labels: { confirm: t("Delete"), cancel: t("Cancel") },
                      confirmProps: { color: "red" },
                      onConfirm: () =>
                        void deleteProfile
                          .mutateAsync(profile.id)
                          .catch(showError),
                    })
                  }
                >
                  {t("Delete")}
                </Button>
              </Group>
            </Group>
          </Paper>
        ))
      )}

      <Modal.Root opened={opened} onClose={() => setOpened(false)} size="xl">
        <Modal.Overlay />
        <Modal.Content
          aria-label={
            editingId
              ? t("ai.profiles.editTitle")
              : t("ai.profiles.createTitle")
          }
        >
          <Modal.Body>
            <Group justify="space-between" mb="md">
              <Text component="h2" size="lg" fw={600}>
                {editingId
                  ? t("ai.profiles.editTitle")
                  : t("ai.profiles.createTitle")}
              </Text>
              <AccessibleActionIcon
                variant="subtle"
                label={t("Close")}
                onClick={() => setOpened(false)}
              >
                <IconX size={20} />
              </AccessibleActionIcon>
            </Group>
            {editingId && detailQuery.isLoading ? (
              <Loader size="sm" />
            ) : (
              <Stack gap="md">
                <Group grow align="flex-start">
                  <TextInput
                    label={t("ai.profiles.name")}
                    maxLength={AI_ASSISTANT_PROFILE_LIMITS.name}
                    required
                    {...form.getInputProps("name")}
                  />
                  <Select
                    label={t("ai.profiles.icon")}
                    data={AI_ASSISTANT_PROFILE_ICONS.map((icon) => ({
                      value: icon,
                      label: icon,
                    }))}
                    allowDeselect={false}
                    {...form.getInputProps("icon")}
                  />
                </Group>
                <TextInput
                  label={t("ai.profiles.profileDescription")}
                  maxLength={AI_ASSISTANT_PROFILE_LIMITS.description}
                  {...form.getInputProps("description")}
                />
                <Textarea
                  label={t("ai.profiles.instructions")}
                  minRows={5}
                  maxLength={AI_ASSISTANT_PROFILE_LIMITS.instructions}
                  required
                  {...form.getInputProps("instructions")}
                />
                <Switch
                  label={t("ai.profiles.enabled")}
                  {...form.getInputProps("enabled", { type: "checkbox" })}
                />
                <Switch
                  label={t("ai.profiles.inheritQuickCommands")}
                  {...form.getInputProps("inheritQuickCommands", {
                    type: "checkbox",
                  })}
                />
                {!form.values.inheritQuickCommands && (
                  <Stack gap="xs">
                    {form.values.quickCommands.map((command, index) => (
                      <Paper
                        key={command.id || index}
                        withBorder
                        p="sm"
                        radius="md"
                      >
                        <Stack gap="sm">
                          <Group grow align="flex-start">
                            <TextInput
                              label={t("ai.profiles.commandLabel")}
                              maxLength={120}
                              {...form.getInputProps(
                                `quickCommands.${index}.label`,
                              )}
                            />
                            <TextInput
                              label={t("ai.settings.commandDescription")}
                              description={t(
                                "ai.settings.commandDescriptionHint",
                              )}
                              maxLength={500}
                              styles={{
                                description: {
                                  color: "var(--mantine-color-text)",
                                },
                              }}
                              {...form.getInputProps(
                                `quickCommands.${index}.description`,
                              )}
                            />
                          </Group>
                          <Textarea
                            label={t("ai.profiles.commandPrompt")}
                            minRows={2}
                            maxLength={4000}
                            {...form.getInputProps(
                              `quickCommands.${index}.prompt`,
                            )}
                          />
                          <Group justify="space-between">
                            <Switch
                              label={t("ai.settings.commandEnabled")}
                              {...form.getInputProps(
                                `quickCommands.${index}.enabled`,
                                { type: "checkbox" },
                              )}
                            />
                            <Group gap="xs">
                              <AccessibleActionIcon
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
                                variant="subtle"
                                color="red"
                                label={t("Delete")}
                                onClick={() =>
                                  form.removeListItem("quickCommands", index)
                                }
                              >
                                <IconTrash size={16} />
                              </AccessibleActionIcon>
                            </Group>
                          </Group>
                        </Stack>
                      </Paper>
                    ))}
                    <Button
                      variant="default"
                      onClick={() =>
                        form.insertListItem("quickCommands", {
                          id: crypto.randomUUID(),
                          label: "",
                          description: "",
                          prompt: "",
                          enabled: true,
                          position: form.values.quickCommands.length,
                        })
                      }
                    >
                      {t("ai.profiles.addCommand")}
                    </Button>
                  </Stack>
                )}
                <Group grow align="flex-start">
                  <TextInput
                    label={t("ai.profiles.modelOverride")}
                    maxLength={AI_ASSISTANT_PROFILE_LIMITS.modelId}
                    disabled={profilesQuery.data.modelOverridesEnabled !== true}
                    {...form.getInputProps("chatModelOverride")}
                  />
                  <NumberInput
                    label={t("ai.profiles.temperatureOverride")}
                    min={0}
                    max={2}
                    decimalScale={2}
                    disabled={profilesQuery.data.modelOverridesEnabled !== true}
                    {...form.getInputProps("temperatureOverride")}
                  />
                  <NumberInput
                    label={t("ai.profiles.maxTokensOverride")}
                    min={1}
                    disabled={profilesQuery.data.modelOverridesEnabled !== true}
                    {...form.getInputProps("maxOutputTokensOverride")}
                  />
                </Group>
                <MultiSelect
                  label={t("ai.profiles.builtinTools")}
                  data={capabilityOptions}
                  searchable
                  {...form.getInputProps("allowedBuiltinCapabilities")}
                />
                <MultiSelect
                  label={t("ai.profiles.externalTools")}
                  description={t("ai.profiles.externalToolsDescription")}
                  styles={{
                    description: { color: "var(--mantine-color-text)" },
                  }}
                  data={externalOptions}
                  searchable
                  {...form.getInputProps("allowedExternalTools")}
                />
                <MultiSelect
                  label={t("ai.profiles.visibleGroups")}
                  data={groupOptions}
                  searchable
                  value={form.values.groupPolicies.map(
                    (policy) => policy.groupId,
                  )}
                  onChange={(groupIds) => {
                    const current = new Map(
                      form.values.groupPolicies.map((policy) => [
                        policy.groupId,
                        policy,
                      ]),
                    );
                    form.setFieldValue(
                      "groupPolicies",
                      groupIds.map(
                        (groupId) =>
                          current.get(groupId) ?? {
                            groupId,
                            available: true,
                            allowedBuiltinCapabilities: null,
                          },
                      ),
                    );
                  }}
                />
                {form.values.groupPolicies.map((policy, index) => (
                  <Paper key={policy.groupId} withBorder p="sm">
                    <Stack gap="xs">
                      <Checkbox
                        label={t("ai.profiles.groupAvailable", {
                          group:
                            groupOptions.find(
                              (group) => group.value === policy.groupId,
                            )?.label ?? policy.groupId,
                        })}
                        checked={policy.available}
                        onChange={(event) =>
                          form.setFieldValue(
                            `groupPolicies.${index}.available`,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <MultiSelect
                        label={t("ai.profiles.groupBuiltinTools")}
                        description={t(
                          "ai.profiles.groupBuiltinToolsDescription",
                        )}
                        styles={{
                          description: { color: "var(--mantine-color-text)" },
                        }}
                        data={capabilityOptions.filter((option) =>
                          form.values.allowedBuiltinCapabilities.includes(
                            option.value as AiBuiltinToolCapability,
                          ),
                        )}
                        clearable
                        value={policy.allowedBuiltinCapabilities ?? []}
                        onChange={(value) =>
                          form.setFieldValue(
                            `groupPolicies.${index}.allowedBuiltinCapabilities`,
                            value as AiBuiltinToolCapability[],
                          )
                        }
                      />
                    </Stack>
                  </Paper>
                ))}
                <Switch
                  label={t("ai.profiles.autoStart")}
                  {...form.getInputProps("autoStart", { type: "checkbox" })}
                />
                {form.values.autoStart && (
                  <Textarea
                    label={t("ai.profiles.launchMessage")}
                    maxLength={AI_ASSISTANT_PROFILE_LIMITS.launchMessage}
                    required
                    {...form.getInputProps("launchMessage")}
                  />
                )}
                {editingId && detailQuery.data && (
                  <Paper withBorder p="sm">
                    <Group justify="space-between">
                      <div>
                        <Text fw={600}>{t("ai.profiles.verification")}</Text>
                        <Text size="sm" c="dimmed">
                          {t(
                            `ai.profiles.agentReason.${detailQuery.data.agent.reason}`,
                          )}
                        </Text>
                      </div>
                      <Group gap="xs">
                        <Button
                          variant="default"
                          loading={testModel.isPending}
                          onClick={() =>
                            void testModel
                              .mutateAsync(editingId)
                              .then(() =>
                                notifications.show({
                                  color: "green",
                                  message: t("ai.profiles.modelTestPassed"),
                                }),
                              )
                              .catch(showError)
                          }
                        >
                          {t("ai.profiles.testModel")}
                        </Button>
                        <Button
                          loading={testAgent.isPending}
                          onClick={() =>
                            void testAgent
                              .mutateAsync(editingId)
                              .then(() =>
                                notifications.show({
                                  color: "green",
                                  message: t("ai.profiles.agentTestPassed"),
                                }),
                              )
                              .catch(showError)
                          }
                        >
                          {t("ai.profiles.testAgent")}
                        </Button>
                      </Group>
                    </Group>
                  </Paper>
                )}
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => setOpened(false)}>
                    {t("Cancel")}
                  </Button>
                  <Button
                    loading={createProfile.isPending || updateProfile.isPending}
                    onClick={() => void save()}
                  >
                    {t("Save")}
                  </Button>
                </Group>
              </Stack>
            )}
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </Stack>
  );
}

function toForm(profile: AiAssistantProfile): ProfileForm {
  return {
    name: profile.name,
    description: profile.description ?? "",
    icon: profile.icon,
    instructions: profile.instructions,
    enabled: profile.enabled,
    inheritQuickCommands: profile.quickCommands === null,
    quickCommands: profile.quickCommands ?? [],
    chatModelOverride: profile.chatModelOverride ?? "",
    temperatureOverride: profile.temperatureOverride ?? "",
    maxOutputTokensOverride: profile.maxOutputTokensOverride ?? "",
    allowedBuiltinCapabilities: profile.allowedBuiltinCapabilities,
    allowedExternalTools: profile.allowedExternalTools.map(
      (tool) => `${tool.bindingId}::${tool.toolName}`,
    ),
    groupPolicies: profile.groupPolicies,
    autoStart: profile.autoStart,
    launchMessage: profile.launchMessage ?? "",
  };
}
