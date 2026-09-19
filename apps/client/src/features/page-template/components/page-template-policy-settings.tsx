import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { AsyncQueryState } from "@/components/ui/async-query-state";
import {
  SettingsSaveBar,
  useSettingsDraft,
} from "@/features/space/components/settings/settings-draft";
import {
  getPageTemplateGroupPolicy,
  getPageTemplatePolicyGroups,
  getPageTemplateSpacePolicy,
  updatePageTemplateGroupPolicy,
  updatePageTemplateSpacePolicy,
} from "../services/page-template-api";
import { PAGE_TEMPLATE_QUERY_KEYS } from "../queries/page-template-query";
import type {
  PageTemplateAction,
  PageTemplateGroupPolicy,
  PageTemplateSpacePolicy,
} from "../services/page-template-api";

const spaceFields = [
  ["templatesEnabled", "Enable page templates in this space"],
  ["allowCreateTemplate", "Allow creating and managing templates"],
  ["allowRegularTemplate", "Allow independent copies"],
  ["allowSyncedTemplate", "Allow linked pages"],
] as const;
const groupActions: ReadonlyArray<readonly [PageTemplateAction, string]> = [
  ["create_template", "Create template"],
  ["manage_template", "Template actions"],
  ["use_regular_template", "Allow independent copies"],
  ["use_synced_template", "Allow linked pages"],
];

export function PageTemplateSpacePolicySettings({
  spaceId,
  readOnly,
}: {
  spaceId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["page-templates", "space-policy", spaceId],
    queryFn: () => getPageTemplateSpacePolicy(spaceId),
  });
  return (
    <AsyncQueryState
      state={
        query.data
          ? "ready"
          : query.isPending
            ? "loading"
            : query.isError
              ? "error"
              : "ready"
      }
      loadingLabel={t("Page templates")}
      errorTitle={t("Could not load templates")}
      emptyTitle={t("No templates found")}
      onRetry={() => void query.refetch()}
      retryLabel={t("Retry")}
    >
      {query.isError && query.data && (
        <Alert color="orange">{t("spaceAdmin.refreshFailed")}</Alert>
      )}
      {query.data && (
        <SpacePolicyForm
          key={spaceId}
          policy={query.data}
          readOnly={readOnly}
          reload={async () => (await query.refetch()).data}
        />
      )}
    </AsyncQueryState>
  );
}

function ConflictNotice({ reload }: { reload: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert color="orange" title={t("spaceAdmin.conflictTitle")}>
      <Stack gap="sm">
        <Text size="sm">{t("spaceAdmin.conflictDescription")}</Text>
        <Button variant="light" onClick={reload}>
          {t("spaceAdmin.reloadPolicy")}
        </Button>
      </Stack>
    </Alert>
  );
}

function SpacePolicyForm({
  policy,
  readOnly,
  reload,
}: {
  policy: PageTemplateSpacePolicy;
  readOnly?: boolean;
  reload: () => Promise<PageTemplateSpacePolicy | undefined>;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const form = useSettingsDraft(policy);
  const [conflict, setConflict] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupDirty, setGroupDirty] = useState(false);
  const [groupPending, setGroupPending] = useState(false);
  const groups = useQuery({
    queryKey: ["page-templates", "policy-groups", policy.spaceId],
    enabled: !readOnly,
    queryFn: async () => {
      const items: Array<{ value: string; label: string }> = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await getPageTemplatePolicyGroups(policy.spaceId, {
          limit: 50,
          cursor,
        });
        items.push(
          ...page.items.map((group) => ({
            value: group.id,
            label: group.name,
          })),
        );
        if (!page.nextCursor) break;
        if (seen.has(page.nextCursor))
          throw new Error("group_pagination_cursor_repeated");
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);
      return [...new Map(items.map((group) => [group.value, group])).values()];
    },
  });
  const selectGroup = (next: string | null) => {
    const change = () => {
      setGroupDirty(false);
      setGroupId(next);
    };
    if (!groupDirty) return change();
    modals.openConfirmModal({
      title: t("spaceAdmin.leaveTitle"),
      children: <Text>{t("spaceAdmin.leaveDescription")}</Text>,
      labels: {
        confirm: t("spaceAdmin.discardAndLeave"),
        cancel: t("spaceAdmin.keepEditing"),
      },
      onConfirm: change,
    });
  };
  const effective = policy.systemEnabled && policy.templatesEnabled;
  return (
    <Stack gap="lg">
      <Group>
        <Badge
          color={effective ? "teal" : "gray"}
          variant="light"
          c="var(--mantine-color-text)"
        >
          {t("Effective: {{value}}", {
            value: t(effective ? "Enabled" : "Disabled"),
          })}
        </Badge>
      </Group>
      {!policy.systemEnabled && (
        <Alert color="yellow">
          {t("Page templates are disabled by the server administrator.")}
        </Alert>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.save(async (value, initial) => {
            try {
              const saved = await updatePageTemplateSpacePolicy(initial, value);
              client.setQueryData(
                ["page-templates", "space-policy", policy.spaceId],
                saved,
              );
              void client.invalidateQueries({
                queryKey: PAGE_TEMPLATE_QUERY_KEYS.capabilities(policy.spaceId),
              });
              void client.invalidateQueries({ queryKey: ["spaces"] });
              setConflict(false);
              notifications.show({ message: t("Saved") });
              return saved;
            } catch (error: any) {
              setConflict(error?.response?.status === 409);
              throw error;
            }
          });
        }}
      >
        <Stack>
          {spaceFields.map(([key, label]) => (
            <Checkbox
              key={key}
              label={t(label)}
              checked={form.value[key]}
              disabled={readOnly || form.pending}
              onChange={(event) =>
                form.setValue({
                  ...form.value,
                  [key]: event.currentTarget.checked,
                })
              }
            />
          ))}
          {conflict && (
            <ConflictNotice
              reload={() =>
                void reload().then((next) => {
                  if (next) {
                    form.reset(next);
                    setConflict(false);
                  }
                })
              }
            />
          )}
        </Stack>
        {!readOnly && (
          <SettingsSaveBar
            {...form}
            onCancel={() => {
              form.reset();
              setConflict(false);
            }}
          />
        )}
      </form>
      {!readOnly && (
        <>
          <Divider label={t("Groups")} labelPosition="left" />
          <Text size="sm" c="dimmed">
            {t(
              "Group permissions are intersected. A denied action in any group stays denied.",
            )}
          </Text>
          <Text size="sm" c="dimmed">
            {t("spaceAdmin.templateAdminRules")}
          </Text>
          <AsyncQueryState
            state={
              groups.isPending ? "loading" : groups.isError ? "error" : "ready"
            }
            loadingLabel={t("Groups")}
            errorTitle={t("Could not load templates")}
            emptyTitle={t("No templates found")}
            onRetry={() => void groups.refetch()}
            retryLabel={t("Retry")}
          >
            <Select
              label={t("Groups")}
              placeholder={t("Select a group")}
              data={groups.data ?? []}
              value={groupId}
              onChange={selectGroup}
              disabled={groupPending}
              searchable
              clearable
            />
          </AsyncQueryState>
          {groupId && (
            <GroupPolicySettings
              key={`${policy.spaceId}:${groupId}`}
              spaceId={policy.spaceId}
              groupId={groupId}
              onDirty={setGroupDirty}
              onPending={setGroupPending}
            />
          )}
        </>
      )}
    </Stack>
  );
}

function GroupPolicySettings({
  spaceId,
  groupId,
  onDirty,
  onPending,
}: {
  spaceId: string;
  groupId: string;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["page-templates", "group-policy", spaceId, groupId],
    queryFn: () => getPageTemplateGroupPolicy(spaceId, groupId),
  });
  return (
    <AsyncQueryState
      state={
        query.data
          ? "ready"
          : query.isPending
            ? "loading"
            : query.isError
              ? "error"
              : "ready"
      }
      loadingLabel={t("Groups")}
      errorTitle={t("Could not load templates")}
      emptyTitle={t("No templates found")}
      onRetry={() => void query.refetch()}
      retryLabel={t("Retry")}
    >
      {query.isError && query.data && (
        <Alert color="orange">{t("spaceAdmin.refreshFailed")}</Alert>
      )}
      {query.data && (
        <GroupPolicyForm
          policy={query.data}
          onDirty={onDirty}
          onPending={onPending}
          reload={async () => (await query.refetch()).data}
        />
      )}
    </AsyncQueryState>
  );
}

function GroupPolicyForm({
  policy,
  onDirty,
  onPending,
  reload,
}: {
  policy: PageTemplateGroupPolicy;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  reload: () => Promise<PageTemplateGroupPolicy | undefined>;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const form = useSettingsDraft(policy);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    onDirty(form.dirty);
    return () => onDirty(false);
  }, [form.dirty, onDirty]);
  useEffect(() => {
    onPending(form.pending);
    return () => onPending(false);
  }, [form.pending, onPending]);
  const change = (allowedActions: PageTemplateAction[] | null) =>
    form.setValue({ ...form.value, allowedActions });
  const reset = (next = policy) => {
    form.reset(next);
    setConflict(false);
  };
  return (
    <Paper withBorder p="md">
      <form
        aria-label={t("spaceAdmin.groupPermissions")}
        onSubmit={(event) => {
          event.preventDefault();
          void form.save(async (value, initial) => {
            try {
              const saved = await updatePageTemplateGroupPolicy(
                initial,
                value.allowedActions,
              );
              client.setQueryData(
                [
                  "page-templates",
                  "group-policy",
                  policy.spaceId,
                  policy.groupId,
                ],
                saved,
              );
              void client.invalidateQueries({
                queryKey: PAGE_TEMPLATE_QUERY_KEYS.capabilities(policy.spaceId),
              });
              setConflict(false);
              notifications.show({ message: t("Saved") });
              return saved;
            } catch (error: any) {
              setConflict(error?.response?.status === 409);
              throw error;
            }
          });
        }}
      >
        <Stack>
          <Text fw={600}>{t("spaceAdmin.groupPermissions")}</Text>
          <Checkbox
            label={t("Inherit from space policy")}
            checked={form.value.allowedActions === null}
            disabled={form.pending}
            onChange={(event) =>
              change(
                event.currentTarget.checked
                  ? null
                  : groupActions.map(([action]) => action),
              )
            }
          />
          {groupActions.map(([action, label]) => (
            <Checkbox
              key={action}
              label={t(label)}
              checked={
                form.value.allowedActions === null ||
                form.value.allowedActions.includes(action)
              }
              disabled={form.pending || form.value.allowedActions === null}
              onChange={(event) =>
                change(
                  event.currentTarget.checked
                    ? [...(form.value.allowedActions ?? []), action]
                    : (form.value.allowedActions ?? []).filter(
                        (item) => item !== action,
                      ),
                )
              }
            />
          ))}
          {conflict && (
            <ConflictNotice
              reload={() =>
                void reload().then((next) => {
                  if (next) reset(next);
                })
              }
            />
          )}
        </Stack>
        <SettingsSaveBar {...form} onCancel={() => reset()} />
      </form>
    </Paper>
  );
}
