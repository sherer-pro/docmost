import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconChevronRight,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import {
  getPageTemplateGroupPolicy,
  getPageTemplatePolicyGroups,
  getPageTemplateSpacePolicy,
  getPageTemplateWorkspacePolicy,
  updatePageTemplateGroupPolicy,
  updatePageTemplateSpacePolicy,
  updatePageTemplateWorkspacePolicy,
} from "../services/page-template-api";
import type {
  PageTemplateAction,
  PageTemplateGroupPolicy,
  PageTemplateSpacePolicy,
  PageTemplateWorkspacePolicy,
} from "../services/page-template-api";
import { PAGE_TEMPLATE_QUERY_KEYS } from "../queries/page-template-query";
import { queryClient } from "@/lib/query-client";
import classes from "./page-template-policy-settings.module.css";

function isRevisionConflict(error: any): boolean {
  return error?.response?.status === 409;
}

function PolicySkeleton() {
  return (
    <Stack gap="md" role="status">
      <Skeleton h={18} w="34%" />
      <Skeleton h={64} radius="md" />
      <Skeleton h={64} radius="md" />
    </Stack>
  );
}

function PolicyError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      compact
      icon={IconAlertCircle}
      title={t("Could not load templates")}
      description={t("Try loading the template list again.")}
      action={
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={onRetry}
        >
          {t("Retry")}
        </Button>
      }
    />
  );
}

function EffectiveBadge({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge color={enabled ? "teal" : "gray"} variant="light">
      {t("Effective: {{value}}", {
        value: enabled ? t("Enabled") : t("Disabled"),
      })}
    </Badge>
  );
}

export function PageTemplateWorkspacePolicySettings() {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState<PageTemplateWorkspacePolicy>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setPolicy(await getPageTemplateWorkspacePolicy());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  if (loading) return <PolicySkeleton />;
  if (loadError || !policy) {
    return <PolicyError onRetry={() => void loadPolicy()} />;
  }

  const effectiveEnabled = policy.systemEnabled && policy.enabled;

  const updateEnabled = async (enabled: boolean) => {
    setPending(true);
    try {
      setPolicy(await updatePageTemplateWorkspacePolicy(policy, enabled));
      await queryClient.invalidateQueries({
        queryKey: ["page-templates", "capabilities"],
      });
      notifications.show({ message: t("Saved") });
    } catch (error) {
      if (isRevisionConflict(error)) {
        notifications.show({
          color: "red",
          message: t("The page changed. Refresh and try again."),
        });
        await loadPolicy();
      } else {
        notifications.show({
          color: "red",
          message: t("Could not update template."),
        });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Stack gap="md">
      {!policy.systemEnabled && (
        <Alert color="yellow">
          {t("Page templates are disabled by the server administrator.")}
        </Alert>
      )}
      <Paper withBorder className={classes.policyCard}>
        <ResponsiveSettingsRow>
          <ResponsiveSettingsContent>
            <Group gap="xs" wrap="wrap">
              <Text size="md" fw={600}>
                {t("Page templates")}
              </Text>
              <EffectiveBadge enabled={effectiveEnabled} />
            </Group>
            <Text size="sm" c="dimmed">
              {t("Spaces remain disabled until explicitly enabled.")}
            </Text>
            {!policy.systemEnabled && (
              <Text size="xs" c="dimmed">
                {t("Page templates are disabled by the server administrator.")}
              </Text>
            )}
          </ResponsiveSettingsContent>
          <ResponsiveSettingsControl wide>
            <Tooltip
              label={
                !policy.systemEnabled
                  ? t(
                      "Page templates are disabled by the server administrator.",
                    )
                  : undefined
              }
              disabled={policy.systemEnabled}
            >
              <Checkbox
                label={t("Enable page templates for this workspace")}
                checked={policy.enabled}
                disabled={!policy.systemEnabled || pending}
                onChange={(event) =>
                  void updateEnabled(event.currentTarget.checked)
                }
              />
            </Tooltip>
          </ResponsiveSettingsControl>
        </ResponsiveSettingsRow>
      </Paper>
    </Stack>
  );
}

export function PageTemplateSpacePolicySettings({
  spaceId,
  readOnly,
}: {
  spaceId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState<PageTemplateSpacePolicy>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [groups, setGroups] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupPolicy, setGroupPolicy] = useState<PageTemplateGroupPolicy>();
  const policyRequest = useRef(0);
  const groupsRequest = useRef(0);
  const groupPolicyRequest = useRef(0);
  const mutationRequest = useRef(0);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState(false);
  const [pending, setPending] = useState(false);

  const loadPolicy = useCallback(async () => {
    const requestId = ++policyRequest.current;
    setLoading(true);
    setLoadError(false);
    setPolicy(undefined);
    try {
      const nextPolicy = await getPageTemplateSpacePolicy(spaceId);
      if (policyRequest.current !== requestId) return;
      setPolicy(nextPolicy);
    } catch {
      if (policyRequest.current !== requestId) return;
      setLoadError(true);
    } finally {
      if (policyRequest.current === requestId) setLoading(false);
    }
  }, [spaceId]);

  const loadGroups = useCallback(async () => {
    const requestId = ++groupsRequest.current;
    setGroups([]);
    if (readOnly) {
      setGroupsLoading(false);
      setGroupsError(false);
      return;
    }
    setGroupsLoading(true);
    setGroupsError(false);
    try {
      const allGroups: Array<{ value: string; label: string }> = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;

      do {
        const result = await getPageTemplatePolicyGroups(spaceId, {
          limit: 50,
          cursor,
        });
        if (groupsRequest.current !== requestId) return;
        allGroups.push(
          ...result.items.map((group) => ({
            value: group.id,
            label: group.name,
          })),
        );
        const nextCursor = result.nextCursor;
        if (!nextCursor) break;
        if (seenCursors.has(nextCursor)) {
          throw new Error("group_pagination_cursor_repeated");
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } while (cursor);

      if (groupsRequest.current !== requestId) return;
      setGroups([
        ...new Map(allGroups.map((group) => [group.value, group])).values(),
      ]);
    } catch {
      if (groupsRequest.current !== requestId) return;
      setGroups([]);
      setGroupsError(true);
    } finally {
      if (groupsRequest.current === requestId) setGroupsLoading(false);
    }
  }, [readOnly, spaceId]);

  const loadGroupPolicy = useCallback(
    async (groupId: string) => {
      const requestId = ++groupPolicyRequest.current;
      setGroupLoading(true);
      setGroupError(false);
      try {
        const nextPolicy = await getPageTemplateGroupPolicy(spaceId, groupId);
        if (groupPolicyRequest.current !== requestId) return;
        setGroupPolicy(nextPolicy);
      } catch {
        if (groupPolicyRequest.current !== requestId) return;
        setGroupPolicy(undefined);
        setGroupError(true);
      } finally {
        if (groupPolicyRequest.current === requestId) {
          setGroupLoading(false);
        }
      }
    },
    [spaceId],
  );

  useEffect(() => {
    mutationRequest.current += 1;
    setSelectedGroupId(null);
    setGroupPolicy(undefined);
    setPending(false);
    void loadPolicy();
    void loadGroups();
    return () => {
      policyRequest.current += 1;
      groupsRequest.current += 1;
    };
  }, [loadGroups, loadPolicy]);

  useEffect(() => {
    groupPolicyRequest.current += 1;
    setGroupPolicy(undefined);
    setGroupError(false);
    setGroupLoading(Boolean(selectedGroupId));
    if (selectedGroupId) void loadGroupPolicy(selectedGroupId);
    return () => {
      groupPolicyRequest.current += 1;
    };
  }, [loadGroupPolicy, selectedGroupId]);

  if (loading) return <PolicySkeleton />;
  if (loadError || !policy) {
    return <PolicyError onRetry={() => void loadPolicy()} />;
  }

  const toggle = async (
    key: keyof Pick<
      PageTemplateSpacePolicy,
      | "templatesEnabled"
      | "allowCreateTemplate"
      | "allowRegularTemplate"
      | "allowSyncedTemplate"
    >,
    checked: boolean,
  ) => {
    if (policy.spaceId !== spaceId || pending) return;
    const currentPolicy = policy;
    const requestId = policyRequest.current;
    const mutationId = ++mutationRequest.current;
    setPending(true);
    try {
      const nextPolicy = await updatePageTemplateSpacePolicy(currentPolicy, {
        [key]: checked,
      });
      if (
        policyRequest.current === requestId &&
        nextPolicy.spaceId === spaceId
      ) {
        setPolicy(nextPolicy);
      }
      await queryClient.invalidateQueries({
        queryKey: PAGE_TEMPLATE_QUERY_KEYS.capabilities(spaceId),
      });
      notifications.show({ message: t("Saved") });
    } catch (error) {
      if (isRevisionConflict(error)) {
        notifications.show({
          color: "red",
          message: t("The page changed. Refresh and try again."),
        });
        await loadPolicy();
      } else {
        notifications.show({
          color: "red",
          message: t("Could not update template."),
        });
      }
    } finally {
      if (mutationRequest.current === mutationId) setPending(false);
    }
  };

  const updateGroup = async (allowedActions: PageTemplateAction[] | null) => {
    if (!groupPolicy || groupPolicy.groupId !== selectedGroupId) return;
    const currentPolicy = groupPolicy;
    const selectionRequest = groupPolicyRequest.current;
    const mutationId = ++mutationRequest.current;
    setPending(true);
    try {
      const nextPolicy = await updatePageTemplateGroupPolicy(
        currentPolicy,
        allowedActions,
      );
      if (groupPolicyRequest.current === selectionRequest) {
        setGroupPolicy(nextPolicy);
      }
      notifications.show({ message: t("Saved") });
    } catch (error) {
      if (isRevisionConflict(error)) {
        notifications.show({
          color: "red",
          message: t("The page changed. Refresh and try again."),
        });
        if (groupPolicyRequest.current === selectionRequest) {
          await loadGroupPolicy(currentPolicy.groupId);
        }
      } else {
        notifications.show({
          color: "red",
          message: t("Could not update template."),
        });
      }
    } finally {
      if (mutationRequest.current === mutationId) setPending(false);
    }
  };

  const spaceRows = [
    {
      key: "allowCreateTemplate",
      label: t("Allow creating and managing templates"),
    },
    {
      key: "allowRegularTemplate",
      label: t("Allow independent copies"),
    },
    {
      key: "allowSyncedTemplate",
      label: t("Allow linked pages"),
    },
  ] as const;
  const groupActions = [
    ["create_template", t("Create template")],
    ["manage_template", t("Template actions")],
    ["use_regular_template", t("Allow independent copies")],
    ["use_synced_template", t("Allow linked pages")],
  ] as const satisfies ReadonlyArray<readonly [PageTemplateAction, string]>;

  const parentEnabled = policy.systemEnabled && policy.workspaceEnabled;
  const spaceEffective = parentEnabled && policy.templatesEnabled;
  const activeGroupPolicy =
    groupPolicy?.groupId === selectedGroupId ? groupPolicy : undefined;
  const parentDisabledReason = !policy.systemEnabled
    ? t("Page templates are disabled by the server administrator.")
    : !policy.workspaceEnabled
      ? t("Page templates are disabled for this workspace.")
      : undefined;

  const actionAllowedBySpace = (action: PageTemplateAction) => {
    if (!spaceEffective) return false;
    if (action === "create_template" || action === "manage_template") {
      return policy.allowCreateTemplate;
    }
    return action === "use_regular_template"
      ? policy.allowRegularTemplate
      : policy.allowSyncedTemplate;
  };
  const groupHasEffectiveAction = activeGroupPolicy
    ? groupActions.some(
        ([action]) =>
          actionAllowedBySpace(action) &&
          (activeGroupPolicy.allowedActions === null ||
            activeGroupPolicy.allowedActions.includes(action)),
      )
    : spaceEffective;

  return (
    <Stack gap="md">
      <div className={classes.hierarchy} aria-label={t("Effective result")}>
        <PolicyGate label={t("Deployment")} enabled={policy.systemEnabled} />
        <IconChevronRight size={14} aria-hidden />
        <PolicyGate label={t("Workspace")} enabled={policy.workspaceEnabled} />
        <IconChevronRight size={14} aria-hidden />
        <PolicyGate label={t("Space")} enabled={spaceEffective} />
        {selectedGroupId && (
          <>
            <IconChevronRight size={14} aria-hidden />
            <PolicyGate label={t("Group")} enabled={groupHasEffectiveAction} />
          </>
        )}
      </div>
      <Group justify="space-between" align="center">
        <Text fw={600}>{t("Page templates")}</Text>
        <EffectiveBadge enabled={spaceEffective} />
      </Group>

      {parentDisabledReason && (
        <Alert color="yellow">{parentDisabledReason}</Alert>
      )}

      <Paper withBorder className={classes.policyCard}>
        <PolicyCheckboxRow
          label={t("Enable page templates in this space")}
          checked={policy.templatesEnabled}
          effective={spaceEffective}
          disabled={Boolean(readOnly) || pending || !parentEnabled}
          disabledReason={readOnly ? t("Read only") : parentDisabledReason}
          onChange={(checked) => void toggle("templatesEnabled", checked)}
        />
        <Divider />
        <div className={classes.nestedPolicy}>
          {spaceRows.map(({ key, label }) => (
            <PolicyCheckboxRow
              key={key}
              label={label}
              checked={policy[key]}
              effective={spaceEffective && policy[key]}
              disabled={Boolean(readOnly) || pending || !spaceEffective}
              disabledReason={
                readOnly
                  ? t("Read only")
                  : (parentDisabledReason ??
                    (!policy.templatesEnabled
                      ? t("Templates are disabled for this space.")
                      : undefined))
              }
              onChange={(checked) => void toggle(key, checked)}
            />
          ))}
        </div>
      </Paper>

      {!readOnly && (
        <>
          <Divider label={t("Groups")} labelPosition="left" />
          <Text size="sm" c="dimmed">
            {t(
              "Group permissions are intersected. A denied action in any group stays denied.",
            )}
          </Text>
          <Alert color="blue">
            {t(
              "Owners and workspace or space administrators bypass group overrides, but deployment, workspace, and space switches still apply.",
            )}
          </Alert>
          {groupsLoading ? (
            <Skeleton h={36} radius="sm" />
          ) : groupsError ? (
            <PolicyError onRetry={() => void loadGroups()} />
          ) : (
            <Select
              label={t("Groups")}
              data={groups}
              value={selectedGroupId}
              onChange={setSelectedGroupId}
              placeholder={t("Select a group")}
              searchable
              clearable
              disabled={!parentEnabled}
            />
          )}

          {selectedGroupId && groupLoading && <PolicySkeleton />}
          {selectedGroupId && groupError && (
            <PolicyError
              onRetry={() => void loadGroupPolicy(selectedGroupId)}
            />
          )}
          {activeGroupPolicy && !groupLoading && !groupError && (
            <Paper withBorder className={classes.policyCard}>
              <PolicyCheckboxRow
                label={t("Inherit from space policy")}
                checked={activeGroupPolicy.allowedActions === null}
                effective={spaceEffective}
                disabled={pending || !spaceEffective}
                disabledReason={
                  !spaceEffective
                    ? (parentDisabledReason ??
                      t("Templates are disabled for this space."))
                    : undefined
                }
                onChange={(checked) =>
                  void updateGroup(
                    checked
                      ? null
                      : groupActions
                          .map(([action]) => action)
                          .filter(actionAllowedBySpace),
                  )
                }
              />
              <Divider />
              <div className={classes.nestedPolicy}>
                {groupActions.map(([action, label]) => {
                  const inherited = activeGroupPolicy.allowedActions === null;
                  const checked =
                    inherited ||
                    activeGroupPolicy.allowedActions.includes(action);
                  const spaceAllows = actionAllowedBySpace(action);
                  return (
                    <PolicyCheckboxRow
                      key={action}
                      label={label}
                      checked={checked}
                      effective={spaceAllows && checked}
                      disabled={pending || inherited || !spaceAllows}
                      disabledReason={
                        !spaceEffective
                          ? (parentDisabledReason ??
                            t("Templates are disabled for this space."))
                          : inherited
                            ? t("Inherit from space policy")
                            : !spaceAllows
                              ? t("Disabled")
                              : undefined
                      }
                      onChange={(nextChecked) => {
                        const current = activeGroupPolicy.allowedActions ?? [];
                        void updateGroup(
                          nextChecked
                            ? [...new Set([...current, action])]
                            : current.filter((item) => item !== action),
                        );
                      }}
                    />
                  );
                })}
              </div>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function PolicyGate({ label, enabled }: { label: string; enabled: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge color={enabled ? "teal" : "gray"} variant="outline">
      {label}: {enabled ? t("Enabled") : t("Disabled")}
    </Badge>
  );
}

function PolicyCheckboxRow({
  label,
  checked,
  effective,
  disabled,
  disabledReason,
  onChange,
}: {
  label: string;
  checked: boolean;
  effective: boolean;
  disabled: boolean;
  disabledReason?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={classes.policyRow}>
      <Group justify="space-between" gap="md" wrap="nowrap">
        <Tooltip
          label={disabledReason}
          disabled={!disabledReason}
          position="top-start"
          withArrow
        >
          <Checkbox
            label={label}
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
        </Tooltip>
        <EffectiveBadge enabled={effective} />
      </Group>
      {disabledReason && (
        <Text size="xs" c="dimmed" mt={4} pl={30}>
          {disabledReason}
        </Text>
      )}
    </div>
  );
}
