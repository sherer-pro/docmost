import {
  AI_ASSISTANT_PROFILE_ICONS,
  AI_ASSISTANT_PROFILE_LIMITS,
  type AiAssistantProfile,
  type AiAssistantProfileGroupPolicy,
  type AiAssistantProfileIcon,
  type AiBuiltinToolCapability,
  type AiBuiltinToolCatalogEntry,
  type AiBuiltinToolCategory,
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
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconCircle,
  IconDatabase,
  IconEdit,
  IconFileText,
  IconHistory,
  IconLink,
  IconMessages,
  IconPaperclip,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShare,
  IconSitemap,
  IconSparkles,
  IconStack2,
  IconTrash,
  IconUsers,
  IconWand,
  IconX,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { AiAssistantProfileIcon as AssistantProfileIcon } from "./ai-assistant-profile-icon.tsx";
import styles from "./ai-assistant-profiles-settings.module.css";

type ProfileSection =
  | "basics"
  | "instructions"
  | "model"
  | "tools"
  | "access"
  | "launch";

const PROFILE_SECTIONS: Array<{
  value: ProfileSection;
  icon: TablerIcon;
}> = [
  { value: "basics", icon: IconRobot },
  { value: "instructions", icon: IconFileText },
  { value: "model", icon: IconSettings },
  { value: "tools", icon: IconWand },
  { value: "access", icon: IconUsers },
  { value: "launch", icon: IconPlayerPlay },
];

const TOOL_CATEGORY_ICONS: Record<AiBuiltinToolCategory, TablerIcon> = {
  search: IconSearch,
  page_read: IconFileText,
  page_write: IconEdit,
  context: IconStack2,
  database: IconDatabase,
  page_structure: IconSitemap,
  collaboration: IconMessages,
  history: IconHistory,
  attachments: IconPaperclip,
  sharing: IconShare,
};

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
  const [activeSection, setActiveSection] = useState<ProfileSection>("basics");
  const [toolSearch, setToolSearch] = useState("");
  const sectionNavRef = useRef<HTMLElement>(null);
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
    if (!opened) {
      return;
    }

    sectionNavRef.current
      ?.querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
  }, [activeSection, opened]);
  const availableBuiltinTools = useMemo(() => {
    const effective = new Set(toolsQuery.data?.effectiveCapabilities ?? []);
    return (toolsQuery.data?.catalog ?? []).filter(
      (tool) =>
        tool.exposures.includes("agent") && effective.has(tool.capability),
    );
  }, [toolsQuery.data]);

  useEffect(() => {
    const profile = detailQuery.data;
    if (!profile || profile.id !== editingId) return;
    form.setValues(toForm(profile));
    form.resetDirty(toForm(profile));
  }, [detailQuery.data, editingId]);

  const openCreate = () => {
    setEditingId(undefined);
    setActiveSection("basics");
    setToolSearch("");
    form.setValues({
      ...EMPTY_FORM,
      allowedBuiltinCapabilities: toolsQuery.data?.effectiveCapabilities ?? [],
    });
    form.resetDirty();
    setOpened(true);
  };

  const openEdit = (profileId: string) => {
    setEditingId(profileId);
    setActiveSection("basics");
    setToolSearch("");
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
    form.clearErrors();
    if (!values.name.trim()) {
      form.setFieldError("name", t("ai.profiles.requiredField"));
      setActiveSection("basics");
      notifications.show({ color: "red", message: t("ai.profiles.required") });
      return;
    }
    if (!values.instructions.trim()) {
      form.setFieldError("instructions", t("ai.profiles.requiredField"));
      setActiveSection("instructions");
      notifications.show({ color: "red", message: t("ai.profiles.required") });
      return;
    }
    if (values.autoStart && !values.launchMessage.trim()) {
      form.setFieldError("launchMessage", t("ai.profiles.requiredField"));
      setActiveSection("launch");
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

  const isSectionComplete = (section: ProfileSection) => {
    switch (section) {
      case "basics":
        return Boolean(form.values.name.trim());
      case "instructions":
        return Boolean(form.values.instructions.trim());
      case "launch":
        return (
          !form.values.autoStart || Boolean(form.values.launchMessage.trim())
        );
      default:
        return true;
    }
  };

  const activeSectionConfig =
    PROFILE_SECTIONS.find((section) => section.value === activeSection) ??
    PROFILE_SECTIONS[0];
  const ActiveSectionIcon = activeSectionConfig.icon;

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

      <Modal.Root
        opened={opened}
        onClose={() => setOpened(false)}
        size="min(1180px, calc(100vw - 32px))"
        centered
      >
        <Modal.Overlay />
        <Modal.Content
          className={styles.modalContent}
          aria-label={
            editingId
              ? t("ai.profiles.editTitle")
              : t("ai.profiles.createTitle")
          }
        >
          <Modal.Body className={styles.modalBody}>
            <div className={styles.modalLayout}>
              <Group
                className={styles.modalHeader}
                justify="space-between"
                wrap="nowrap"
              >
                <div>
                  <Text component="h2" size="lg" fw={600}>
                    {editingId
                      ? t("ai.profiles.editTitle")
                      : t("ai.profiles.createTitle")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {t("ai.profiles.editorDescription")}
                  </Text>
                </div>
                <AccessibleActionIcon
                  variant="subtle"
                  label={t("Close")}
                  onClick={() => setOpened(false)}
                >
                  <IconX size={20} />
                </AccessibleActionIcon>
              </Group>

              <aside className={styles.sidebar}>
                <Stack className={styles.profilePreview} gap="sm">
                  <Group wrap="nowrap" align="flex-start">
                    <div className={styles.profileAvatar}>
                      <AssistantProfileIcon icon={form.values.icon} size={30} />
                    </div>
                    <div className={styles.profileName}>
                      <Text fw={600} truncate>
                        {form.values.name.trim() ||
                          t("ai.profiles.unnamedProfile")}
                      </Text>
                      <Badge
                        mt={4}
                        size="sm"
                        variant="light"
                        color={form.values.enabled ? "green" : "gray"}
                      >
                        {form.values.enabled
                          ? t("ai.profiles.enabledState")
                          : t("ai.profiles.disabled")}
                      </Badge>
                    </div>
                  </Group>
                  <Group
                    className={styles.inheritanceSummary}
                    gap="xs"
                    wrap="nowrap"
                  >
                    <IconLink size={16} aria-hidden />
                    <Text size="xs" c="dimmed">
                      {form.values.inheritQuickCommands
                        ? t("ai.profiles.quickCommandsInherited")
                        : t("ai.profiles.quickCommandsCustom")}
                    </Text>
                  </Group>
                </Stack>

                <nav
                  ref={sectionNavRef}
                  className={styles.sectionNav}
                  aria-label={t("ai.profiles.sectionsLabel")}
                >
                  {PROFILE_SECTIONS.map((section) => {
                    const SectionIcon = section.icon;
                    const complete = isSectionComplete(section.value);
                    return (
                      <UnstyledButton
                        key={section.value}
                        className={`${styles.sectionNavItem} ${
                          activeSection === section.value
                            ? styles.sectionNavItemActive
                            : ""
                        }`}
                        aria-current={
                          activeSection === section.value ? "step" : undefined
                        }
                        onClick={() => setActiveSection(section.value)}
                      >
                        <SectionIcon size={19} aria-hidden />
                        <Text
                          className={styles.sectionNavLabel}
                          size="sm"
                          fw={activeSection === section.value ? 600 : 500}
                        >
                          {t(`ai.profiles.section.${section.value}`)}
                        </Text>
                        {complete ? (
                          <IconCheck
                            size={16}
                            color="var(--mantine-color-teal-6)"
                            aria-hidden
                          />
                        ) : (
                          <IconCircle
                            size={14}
                            color="var(--mantine-color-gray-5)"
                            aria-hidden
                          />
                        )}
                      </UnstyledButton>
                    );
                  })}
                </nav>

                <div className={styles.iconPicker}>
                  <Text size="sm" fw={600} mb="sm">
                    {t("ai.profiles.icon")}
                  </Text>
                  <div className={styles.iconGrid}>
                    {AI_ASSISTANT_PROFILE_ICONS.map((icon) => {
                      const label = t(`ai.profiles.iconName.${icon}`);
                      return (
                        <Tooltip key={icon} label={label} withArrow>
                          <UnstyledButton
                            className={`${styles.iconChoice} ${
                              form.values.icon === icon
                                ? styles.iconChoiceActive
                                : ""
                            }`}
                            aria-label={label}
                            aria-pressed={form.values.icon === icon}
                            onClick={() => form.setFieldValue("icon", icon)}
                          >
                            <AssistantProfileIcon icon={icon} size={22} />
                          </UnstyledButton>
                        </Tooltip>
                      );
                    })}
                  </div>
                  <Text size="xs" c="dimmed" mt="sm">
                    {t("ai.profiles.iconDescription")}
                  </Text>
                </div>
              </aside>

              <main className={styles.content}>
                {editingId && detailQuery.isLoading ? (
                  <Loader size="sm" />
                ) : (
                  <Stack gap="lg">
                    <Group
                      className={styles.sectionHeading}
                      gap="sm"
                      wrap="nowrap"
                      align="flex-start"
                    >
                      <ThemeIcon variant="light" size={36} radius="md">
                        <ActiveSectionIcon size={20} aria-hidden />
                      </ThemeIcon>
                      <div>
                        <Text component="h3" size="xl" fw={600}>
                          {t(`ai.profiles.section.${activeSection}`)}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {t(`ai.profiles.sectionDescription.${activeSection}`)}
                        </Text>
                      </div>
                    </Group>

                    {activeSection === "basics" && (
                      <Stack gap="md">
                        <div className={styles.fieldGrid}>
                          <TextInput
                            label={t("ai.profiles.name")}
                            maxLength={AI_ASSISTANT_PROFILE_LIMITS.name}
                            required
                            {...form.getInputProps("name")}
                          />
                          <TextInput
                            label={t("ai.profiles.profileDescription")}
                            maxLength={AI_ASSISTANT_PROFILE_LIMITS.description}
                            {...form.getInputProps("description")}
                          />
                        </div>
                        <Switch
                          label={t("ai.profiles.enabled")}
                          description={t("ai.profiles.enabledDescription")}
                          {...form.getInputProps("enabled", {
                            type: "checkbox",
                          })}
                        />
                        <Paper
                          className={styles.mobileIconPicker}
                          withBorder
                          p="md"
                          radius="md"
                        >
                          <Text size="sm" fw={600} mb="xs">
                            {t("ai.profiles.icon")}
                          </Text>
                          <Text size="xs" c="dimmed" mb="sm">
                            {t("ai.profiles.iconMobileHint")}
                          </Text>
                          <div className={styles.iconGrid}>
                            {AI_ASSISTANT_PROFILE_ICONS.map((icon) => {
                              const label = t(`ai.profiles.iconName.${icon}`);
                              return (
                                <Tooltip key={icon} label={label} withArrow>
                                  <UnstyledButton
                                    className={`${styles.iconChoice} ${
                                      form.values.icon === icon
                                        ? styles.iconChoiceActive
                                        : ""
                                    }`}
                                    aria-label={label}
                                    aria-pressed={form.values.icon === icon}
                                    onClick={() =>
                                      form.setFieldValue("icon", icon)
                                    }
                                  >
                                    <AssistantProfileIcon
                                      icon={icon}
                                      size={20}
                                    />
                                  </UnstyledButton>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </Paper>
                      </Stack>
                    )}

                    {activeSection === "instructions" && (
                      <Stack gap="md">
                        <Textarea
                          label={t("ai.profiles.instructions")}
                          description={t("ai.profiles.instructionsDescription")}
                          minRows={10}
                          autosize
                          maxRows={18}
                          maxLength={AI_ASSISTANT_PROFILE_LIMITS.instructions}
                          required
                          {...form.getInputProps("instructions")}
                        />
                        <Switch
                          label={t("ai.profiles.inheritQuickCommands")}
                          description={t(
                            "ai.profiles.inheritQuickCommandsDescription",
                          )}
                          {...form.getInputProps("inheritQuickCommands", {
                            type: "checkbox",
                          })}
                        />
                        {!form.values.inheritQuickCommands && (
                          <Stack gap="sm">
                            <Group justify="space-between">
                              <div>
                                <Text fw={600}>
                                  {t("ai.profiles.customQuickCommands")}
                                </Text>
                                <Text size="sm" c="dimmed">
                                  {t(
                                    "ai.profiles.customQuickCommandsDescription",
                                  )}
                                </Text>
                              </div>
                              <Button
                                variant="default"
                                leftSection={<IconPlus size={16} />}
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
                            </Group>
                            {form.values.quickCommands.map((command, index) => (
                              <Paper
                                key={command.id || index}
                                className={styles.quickCommandCard}
                                withBorder
                                p="md"
                                radius="md"
                              >
                                <Stack gap="sm">
                                  <div className={styles.fieldGrid}>
                                    <TextInput
                                      label={t("ai.profiles.commandLabel")}
                                      maxLength={120}
                                      {...form.getInputProps(
                                        `quickCommands.${index}.label`,
                                      )}
                                    />
                                    <TextInput
                                      label={t(
                                        "ai.settings.commandDescription",
                                      )}
                                      maxLength={500}
                                      {...form.getInputProps(
                                        `quickCommands.${index}.description`,
                                      )}
                                    />
                                  </div>
                                  <Textarea
                                    label={t("ai.profiles.commandPrompt")}
                                    minRows={3}
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
                                    <Group gap={4}>
                                      <AccessibleActionIcon
                                        variant="subtle"
                                        label={t("ai.settings.moveCommandUp")}
                                        disabled={index === 0}
                                        onClick={() =>
                                          form.reorderListItem(
                                            "quickCommands",
                                            { from: index, to: index - 1 },
                                          )
                                        }
                                      >
                                        <IconArrowUp size={16} />
                                      </AccessibleActionIcon>
                                      <AccessibleActionIcon
                                        variant="subtle"
                                        label={t("ai.settings.moveCommandDown")}
                                        disabled={
                                          index ===
                                          form.values.quickCommands.length - 1
                                        }
                                        onClick={() =>
                                          form.reorderListItem(
                                            "quickCommands",
                                            { from: index, to: index + 1 },
                                          )
                                        }
                                      >
                                        <IconArrowDown size={16} />
                                      </AccessibleActionIcon>
                                      <AccessibleActionIcon
                                        variant="subtle"
                                        color="red"
                                        label={t("Delete")}
                                        onClick={() =>
                                          form.removeListItem(
                                            "quickCommands",
                                            index,
                                          )
                                        }
                                      >
                                        <IconTrash size={16} />
                                      </AccessibleActionIcon>
                                    </Group>
                                  </Group>
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    )}

                    {activeSection === "model" && (
                      <Stack gap="md">
                        {profilesQuery.data.modelOverridesEnabled !== true && (
                          <Alert
                            color="yellow"
                            icon={<IconSettings size={18} />}
                          >
                            {t("ai.profiles.modelOverridesDisabled")}
                          </Alert>
                        )}
                        <div className={styles.modelGrid}>
                          <TextInput
                            label={t("ai.profiles.modelOverride")}
                            maxLength={AI_ASSISTANT_PROFILE_LIMITS.modelId}
                            disabled={
                              profilesQuery.data.modelOverridesEnabled !== true
                            }
                            {...form.getInputProps("chatModelOverride")}
                          />
                          <NumberInput
                            label={t("ai.profiles.temperatureOverride")}
                            min={0}
                            max={2}
                            decimalScale={2}
                            disabled={
                              profilesQuery.data.modelOverridesEnabled !== true
                            }
                            {...form.getInputProps("temperatureOverride")}
                          />
                          <NumberInput
                            label={t("ai.profiles.maxTokensOverride")}
                            min={1}
                            disabled={
                              profilesQuery.data.modelOverridesEnabled !== true
                            }
                            {...form.getInputProps("maxOutputTokensOverride")}
                          />
                        </div>
                        {editingId && detailQuery.data && (
                          <Paper
                            className={styles.verificationCard}
                            withBorder
                            p="md"
                          >
                            <Group justify="space-between">
                              <div>
                                <Text fw={600}>
                                  {t("ai.profiles.modelVerification")}
                                </Text>
                                <Text size="sm" c="dimmed">
                                  {t(
                                    "ai.profiles.modelVerificationDescription",
                                  )}
                                </Text>
                              </div>
                              <Button
                                variant="default"
                                leftSection={<IconSettings size={16} />}
                                loading={testModel.isPending}
                                onClick={() =>
                                  void testModel
                                    .mutateAsync(editingId)
                                    .then(() =>
                                      notifications.show({
                                        color: "green",
                                        message: t(
                                          "ai.profiles.modelTestPassed",
                                        ),
                                      }),
                                    )
                                    .catch(showError)
                                }
                              >
                                {t("ai.profiles.testModel")}
                              </Button>
                            </Group>
                          </Paper>
                        )}
                      </Stack>
                    )}

                    {activeSection === "tools" && (
                      <Stack gap="lg">
                        <ProfileToolPicker
                          catalog={availableBuiltinTools}
                          value={form.values.allowedBuiltinCapabilities}
                          search={toolSearch}
                          onSearchChange={setToolSearch}
                          onChange={(value) =>
                            form.setFieldValue(
                              "allowedBuiltinCapabilities",
                              value,
                            )
                          }
                        />
                        <MultiSelect
                          label={t("ai.profiles.externalTools")}
                          description={t(
                            "ai.profiles.externalToolsDescription",
                          )}
                          data={externalOptions}
                          searchable
                          {...form.getInputProps("allowedExternalTools")}
                        />
                        {editingId && detailQuery.data && (
                          <Paper
                            className={styles.verificationCard}
                            withBorder
                            p="md"
                          >
                            <Group justify="space-between">
                              <div>
                                <Text fw={600}>
                                  {t("ai.profiles.verification")}
                                </Text>
                                <Text size="sm" c="dimmed">
                                  {t(
                                    `ai.profiles.agentReason.${detailQuery.data.agent.reason}`,
                                  )}
                                </Text>
                              </div>
                              <Button
                                leftSection={<IconRobot size={16} />}
                                loading={testAgent.isPending}
                                onClick={() =>
                                  void testAgent
                                    .mutateAsync(editingId)
                                    .then(() =>
                                      notifications.show({
                                        color: "green",
                                        message: t(
                                          "ai.profiles.agentTestPassed",
                                        ),
                                      }),
                                    )
                                    .catch(showError)
                                }
                              >
                                {t("ai.profiles.testAgent")}
                              </Button>
                            </Group>
                          </Paper>
                        )}
                      </Stack>
                    )}

                    {activeSection === "access" && (
                      <Stack gap="md">
                        <MultiSelect
                          label={t("ai.profiles.visibleGroups")}
                          description={t(
                            "ai.profiles.visibleGroupsDescription",
                          )}
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
                        {form.values.groupPolicies.length === 0 && (
                          <Alert color="blue" variant="light">
                            {t("ai.profiles.noGroupPolicies")}
                          </Alert>
                        )}
                        {form.values.groupPolicies.map((policy, index) => (
                          <Paper
                            key={policy.groupId}
                            className={styles.policyCard}
                            withBorder
                            p="md"
                            radius="md"
                          >
                            <Stack gap="sm">
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
                      </Stack>
                    )}

                    {activeSection === "launch" && (
                      <Stack gap="md">
                        <Paper withBorder p="md" radius="md">
                          <Switch
                            label={t("ai.profiles.autoStart")}
                            description={t("ai.profiles.autoStartDescription")}
                            {...form.getInputProps("autoStart", {
                              type: "checkbox",
                            })}
                          />
                        </Paper>
                        {form.values.autoStart && (
                          <Textarea
                            label={t("ai.profiles.launchMessage")}
                            description={t(
                              "ai.profiles.launchMessageDescription",
                            )}
                            minRows={5}
                            maxLength={
                              AI_ASSISTANT_PROFILE_LIMITS.launchMessage
                            }
                            required
                            {...form.getInputProps("launchMessage")}
                          />
                        )}
                      </Stack>
                    )}
                  </Stack>
                )}
              </main>

              <Group className={styles.footer} justify="flex-end">
                <Group className={styles.footerActions} gap="sm">
                  <Button variant="default" onClick={() => setOpened(false)}>
                    {t("Cancel")}
                  </Button>
                  <Button
                    loading={createProfile.isPending || updateProfile.isPending}
                    disabled={editingId !== undefined && detailQuery.isLoading}
                    onClick={() => void save()}
                  >
                    {t("Save")}
                  </Button>
                </Group>
              </Group>
            </div>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </Stack>
  );
}

function ProfileToolPicker({
  catalog,
  value,
  search,
  onSearchChange,
  onChange,
}: {
  catalog: AiBuiltinToolCatalogEntry[];
  value: AiBuiltinToolCapability[];
  search: string;
  onSearchChange: (value: string) => void;
  onChange: (value: AiBuiltinToolCapability[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const selected = new Set(value);
  const normalizedSearch = search.trim().toLocaleLowerCase(i18n.language);
  const visible = catalog.filter((tool) => {
    if (!normalizedSearch) return true;
    const label = t(`ai.toolPolicy.tool.${tool.name}`);
    return `${label} ${tool.capability}`
      .toLocaleLowerCase(i18n.language)
      .includes(normalizedSearch);
  });
  const groups = new Map<AiBuiltinToolCategory, AiBuiltinToolCatalogEntry[]>();
  for (const tool of visible) {
    const items = groups.get(tool.category) ?? [];
    items.push(tool);
    groups.set(tool.category, items);
  }

  const toggleTool = (
    capability: AiBuiltinToolCapability,
    checked: boolean,
  ) => {
    const next = new Set(value);
    if (checked) next.add(capability);
    else next.delete(capability);
    onChange([...next]);
  };

  const toggleCategory = (
    tools: AiBuiltinToolCatalogEntry[],
    checked: boolean,
  ) => {
    const next = new Set(value);
    for (const tool of tools) {
      if (checked) next.add(tool.capability);
      else next.delete(tool.capability);
    }
    onChange([...next]);
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text fw={600}>{t("ai.profiles.builtinToolsShort")}</Text>
          <Text size="sm" c="dimmed">
            {t("ai.profiles.builtinToolsDescription")}
          </Text>
        </div>
        <Badge variant="light">
          {t("ai.profiles.selectedTools", {
            selected: value.length,
            total: catalog.length,
          })}
        </Badge>
      </Group>
      <TextInput
        value={search}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        placeholder={t("ai.profiles.searchTools")}
        leftSection={<IconSearch size={16} aria-hidden />}
        aria-label={t("ai.profiles.searchTools")}
      />
      {groups.size === 0 ? (
        <Alert color="gray">{t("ai.profiles.noToolsFound")}</Alert>
      ) : (
        [...groups.entries()].map(([category, tools]) => {
          const CategoryIcon = TOOL_CATEGORY_ICONS[category];
          const selectedInCategory = tools.filter((tool) =>
            selected.has(tool.capability),
          ).length;
          return (
            <Paper
              key={category}
              className={styles.toolCategory}
              withBorder
              radius="md"
            >
              <Group
                className={styles.toolCategoryHeader}
                justify="space-between"
                wrap="nowrap"
              >
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon variant="light" size={30} radius="sm">
                    <CategoryIcon size={17} aria-hidden />
                  </ThemeIcon>
                  <div>
                    <Text size="sm" fw={600}>
                      {t(`ai.toolPolicy.category.${category}`)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("ai.toolPolicy.categorySelection", {
                        selected: selectedInCategory,
                        total: tools.length,
                      })}
                    </Text>
                  </div>
                </Group>
                <Checkbox
                  checked={
                    selectedInCategory === tools.length && tools.length > 0
                  }
                  indeterminate={
                    selectedInCategory > 0 && selectedInCategory < tools.length
                  }
                  aria-label={t("ai.profiles.toggleToolCategory", {
                    category: t(`ai.toolPolicy.category.${category}`),
                  })}
                  onChange={(event) =>
                    toggleCategory(tools, event.currentTarget.checked)
                  }
                />
              </Group>
              {tools.map((tool) => {
                const label = t(`ai.toolPolicy.tool.${tool.name}`);
                return (
                  <Group
                    key={tool.capability}
                    className={styles.toolRow}
                    wrap="nowrap"
                  >
                    <Checkbox
                      checked={selected.has(tool.capability)}
                      aria-label={label}
                      onChange={(event) =>
                        toggleTool(tool.capability, event.currentTarget.checked)
                      }
                    />
                    <div className={styles.toolIcon}>
                      <CategoryIcon size={17} aria-hidden />
                    </div>
                    <div className={styles.toolLabel}>
                      <Text size="sm" fw={500}>
                        {label}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {tool.capability}
                      </Text>
                    </div>
                    <Badge
                      size="xs"
                      variant="light"
                      color={tool.writeClass === "write" ? "orange" : "gray"}
                    >
                      {t(`ai.profiles.toolClass.${tool.writeClass}`)}
                    </Badge>
                  </Group>
                );
              })}
            </Paper>
          );
        })
      )}
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
