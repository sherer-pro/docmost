import { useEffect, useState } from "react";
import { Alert, Checkbox, Divider, Select, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getGroups } from "@/features/group/services/group-service";
import {
  getPageTemplateGroupPolicy,
  getPageTemplateSpacePolicy,
  getPageTemplateWorkspacePolicy,
  updatePageTemplateGroupPolicy,
  updatePageTemplateSpacePolicy,
  updatePageTemplateWorkspacePolicy,
} from "../services/page-template-api";
import type {
  PageTemplateSpacePolicy,
  PageTemplateAction,
  PageTemplateGroupPolicy,
  PageTemplateWorkspacePolicy,
} from "../services/page-template-api";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";

export function PageTemplateWorkspacePolicySettings() {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState<PageTemplateWorkspacePolicy>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void getPageTemplateWorkspacePolicy()
      .then(setPolicy)
      .catch(() => undefined);
  }, []);
  if (!policy) return null;
  return (
    <Stack gap="md">
      {!policy.systemEnabled && (
        <Alert color="yellow">
          {t("Page templates are disabled by the server administrator.")}
        </Alert>
      )}
      <ResponsiveSettingsRow>
        <ResponsiveSettingsContent>
          <Text size="md">{t("Page templates")}</Text>
          <Text size="sm" c="dimmed">
            {t("Spaces remain disabled until explicitly enabled.")}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {t("Maximum live embed depth: {{depth}}", {
              depth: policy.maxPageEmbedDepth,
            })}
          </Text>
        </ResponsiveSettingsContent>
        <ResponsiveSettingsControl wide>
          <Checkbox
            label={t("Enable page templates for this workspace")}
            checked={policy.enabled}
            disabled={!policy.systemEnabled || pending}
            onChange={async (event) => {
              setPending(true);
              try {
                setPolicy(
                  await updatePageTemplateWorkspacePolicy(
                    policy,
                    event.currentTarget.checked,
                  ),
                );
              } catch {
                // Keep the last server-confirmed policy on request failure.
              } finally {
                setPending(false);
              }
            }}
          />
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>
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
  const [groups, setGroups] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupPolicy, setGroupPolicy] = useState<PageTemplateGroupPolicy>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void getPageTemplateSpacePolicy(spaceId)
      .then(setPolicy)
      .catch(() => undefined);
  }, [spaceId]);
  useEffect(() => {
    if (readOnly) return;
    void getGroups({ limit: 100 })
      .then((result) =>
        setGroups(
          result.items.map((group) => ({ value: group.id, label: group.name })),
        ),
      )
      .catch(() => setGroups([]));
  }, [readOnly, spaceId]);
  useEffect(() => {
    setGroupPolicy(undefined);
    if (!selectedGroupId) return;
    void getPageTemplateGroupPolicy(spaceId, selectedGroupId)
      .then(setGroupPolicy)
      .catch(() => setGroupPolicy(undefined));
  }, [selectedGroupId, spaceId]);
  if (!policy) return null;
  const toggle = async (
    key: keyof Pick<
      PageTemplateSpacePolicy,
      | "templatesEnabled"
      | "allowCreateTemplate"
      | "allowSnapshot"
      | "allowLiveEmbed"
      | "allowPublicLiveEmbed"
    >,
    checked: boolean,
  ) => {
    setPending(true);
    try {
      setPolicy(
        await updatePageTemplateSpacePolicy(policy, { [key]: checked }),
      );
    } catch {
      // Keep the last server-confirmed policy on request failure.
    } finally {
      setPending(false);
    }
  };
  const updateGroup = async (allowedActions: PageTemplateAction[] | null) => {
    if (!groupPolicy) return;
    setPending(true);
    try {
      setGroupPolicy(
        await updatePageTemplateGroupPolicy(groupPolicy, allowedActions),
      );
    } catch {
      // Keep the last server-confirmed policy on request failure.
    } finally {
      setPending(false);
    }
  };
  const groupActions = [
    ["create_template", "Enable page templates in this space"],
    ["manage_template", "Allow creating and managing templates"],
    ["use_snapshot", "Allow creating pages from templates"],
    ["use_live_embed", "Allow live whole-page embeds"],
  ] as const satisfies ReadonlyArray<readonly [PageTemplateAction, string]>;
  return (
    <Stack gap="xs">
      <Text fw={600}>{t("Page templates")}</Text>
      {(
        [
          ["templatesEnabled", "Enable page templates in this space"],
          ["allowCreateTemplate", "Allow creating and managing templates"],
          ["allowSnapshot", "Allow creating pages from templates"],
          ["allowLiveEmbed", "Allow live whole-page embeds"],
          ["allowPublicLiveEmbed", "Allow live embeds in public shares"],
        ] as const
      ).map(([key, label]) => (
        <Checkbox
          key={key}
          label={t(label)}
          checked={policy[key]}
          disabled={readOnly || pending}
          onChange={(event) => void toggle(key, event.currentTarget.checked)}
        />
      ))}
      {!readOnly && (
        <>
          <Divider my="xs" />
          <Text fw={500}>{t("Groups")}</Text>
          <Select
            data={groups}
            value={selectedGroupId}
            onChange={setSelectedGroupId}
            placeholder={t("Select a group")}
            searchable
            clearable
          />
          {groupPolicy && (
            <Stack gap="xs" pl="sm">
              <Checkbox
                label={t("Inherit")}
                checked={groupPolicy.allowedActions === null}
                disabled={pending}
                onChange={(event) =>
                  void updateGroup(
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
                  checked={groupPolicy.allowedActions?.includes(action) ?? true}
                  disabled={pending || groupPolicy.allowedActions === null}
                  onChange={(event) => {
                    const current = groupPolicy.allowedActions ?? [];
                    void updateGroup(
                      event.currentTarget.checked
                        ? [...new Set([...current, action])]
                        : current.filter((item) => item !== action),
                    );
                  }}
                />
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
