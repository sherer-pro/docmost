import { useState } from "react";
import {
  Alert,
  Anchor,
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
import {
  IconArrowDown,
  IconArrowUp,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import {
  userAtom,
  workspaceAtom,
} from "@/features/user/atoms/current-user-atom";
import { queryClient } from "@/lib/query-client";
import AvatarUploader from "@/components/common/avatar-uploader";
import ExportModal from "@/components/common/export-modal";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { AvatarIconType } from "@/features/attachments/types/attachment.types";
import {
  uploadSpaceIcon,
  removeSpaceIcon,
} from "@/features/attachments/services/attachment-service";
import {
  useUpdateSpaceMutation,
  useArchiveSpaceMutation,
  useUnarchiveSpaceMutation,
} from "../../queries/space-query";
import type {
  ISpace,
  ISpaceCustomLink,
  ISpaceDocumentFieldsSettings,
} from "../../types/space.types";
import { EditSpaceForm } from "../edit-space-form";
import DeleteSpaceModal from "../delete-space-modal";
import SpaceTagsSettings from "../space-tags-settings";
import SpaceLabelsSettings from "@/features/label/components/space-labels-settings";
import CustomLinkFormModal, {
  type CustomLinkFormValue,
} from "../custom-links/custom-link-form-modal";
import { getCustomLinkIcon } from "../custom-links/custom-link-icons";
import { useSettingsDraft, SettingsSaveBar } from "./settings-draft";
import classes from "./space-settings-page.module.css";

export function SpaceGeneralSettings({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const changeIcon = async (file?: File) => {
    setPending(true);
    setError(false);
    try {
      if (file) await uploadSpaceIcon(file, space.id);
      else await removeSpaceIcon(space.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["space"] }),
        queryClient.invalidateQueries({ queryKey: ["spaces"] }),
      ]);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Stack gap="lg">
      <Group>
        <AvatarUploader
          currentImageUrl={space.logo}
          fallbackName={space.name}
          size="60px"
          variant="filled"
          type={AvatarIconType.SPACE_ICON}
          onUpload={changeIcon}
          onRemove={() => changeIcon()}
          isLoading={pending}
        />
        <div>
          <Text fw={500}>{t("Icon")}</Text>
          <Text size="sm" c="dimmed">
            {t("spaceAdmin.iconImmediate")}
          </Text>
        </div>
      </Group>
      {error && <Alert color="red">{t("spaceAdmin.saveFailed")}</Alert>}
      <EditSpaceForm space={space} />
    </Stack>
  );
}

export function SpaceDocumentSettings({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const mutation = useUpdateSpaceMutation();
  const form = useSettingsDraft({
    documentFields: space.settings?.documentFields ?? {},
    dictionaryEnabled: space.settings?.dictionary?.enabled === true,
    headingNumberingEnabled: space.settings?.headingNumbering?.enabled === true,
    tagSettings: space.settings?.tags ?? { disabled: [] },
  });
  const fields: [keyof ISpaceDocumentFieldsSettings, string][] = [
    ["status", "Document status"],
    ["readingTime", "Reading time"],
    ["assignee", "Assignee"],
    ["aiRole", "AI role"],
    ["stakeholders", "Stakeholders"],
  ];
  return (
    <Stack gap="lg">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.save(async (value, initial) => {
            const patch: Partial<ISpace> = { spaceId: space.id };
            for (const key of [
              "dictionaryEnabled",
              "headingNumberingEnabled",
              "tagSettings",
            ] as const) {
              if (JSON.stringify(value[key]) !== JSON.stringify(initial[key]))
                (patch as any)[key] = value[key];
            }
            const changedFields = Object.fromEntries(
              fields
                .filter(
                  ([key]) =>
                    value.documentFields[key] !== initial.documentFields[key],
                )
                .map(([key]) => [key, value.documentFields[key]]),
            );
            if (Object.keys(changedFields).length)
              patch.documentFields = changedFields;
            await mutation.mutateAsync(patch);
            return value;
          });
        }}
      >
        <Stack gap="lg">
          <div>
            <Text fw={600} mb="sm">
              {t("Custom document fields")}
            </Text>
            <Stack gap="sm">
              {fields.map(([key, label]) => (
                <Checkbox
                  key={key}
                  label={t(label)}
                  checked={!!form.value.documentFields[key]}
                  disabled={form.pending}
                  onChange={(event) =>
                    form.setValue({
                      ...form.value,
                      documentFields: {
                        ...form.value.documentFields,
                        [key]: event.currentTarget.checked,
                      },
                    })
                  }
                />
              ))}
            </Stack>
          </div>
          <Divider />
          <Checkbox
            label={t("Number headings")}
            description={t(
              "Automatically number H1-H3 headings in this space.",
            )}
            checked={form.value.headingNumberingEnabled}
            disabled={form.pending}
            onChange={(event) =>
              form.setValue({
                ...form.value,
                headingNumberingEnabled: event.currentTarget.checked,
              })
            }
          />
          <Checkbox
            label={t("Enable dictionary")}
            description={t(
              "Highlight dictionary terms in pages and databases.",
            )}
            checked={form.value.dictionaryEnabled}
            disabled={form.pending}
            onChange={(event) =>
              form.setValue({
                ...form.value,
                dictionaryEnabled: event.currentTarget.checked,
              })
            }
          />
          <Anchor component={Link} to={`/s/${space.slug}/dictionary`}>
            {t("spaceAdmin.openDictionary")}
          </Anchor>
          <Divider />
          <SpaceTagsSettings
            settings={form.value.tagSettings}
            disabled={form.pending}
            onChange={(tagSettings) =>
              form.setValue({ ...form.value, tagSettings })
            }
          />
        </Stack>
        <SettingsSaveBar {...form} onCancel={form.reset} />
      </form>
      <Divider />
      <Text size="sm" c="dimmed">
        {t("spaceAdmin.labelsImmediate")}
      </Text>
      <SpaceLabelsSettings spaceId={space.id} />
    </Stack>
  );
}

type PolicyKey = "enforceMfa" | "enforceSso" | "disablePublicSharing";
export function SpaceAccessSettings({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const user = useAtomValue(userAtom);
  const workspace = useAtomValue(workspaceAtom);
  const mutation = useUpdateSpaceMutation();
  const defaults = {
    enforceMfa: workspace?.enforceMfa === true,
    enforceSso: workspace?.enforceSso === true,
    disablePublicSharing: workspace?.settings?.sharing?.disabled === true,
  };
  const form = useSettingsDraft(
    space.policy?.overrides ?? {
      enforceMfa: space.settings?.security?.enforceMfa ?? null,
      enforceSso: space.settings?.security?.enforceSso ?? null,
      disablePublicSharing: space.settings?.sharing?.disabled ?? null,
    },
  );
  const canLoosen = user?.role === "owner" || user?.role === "admin";
  const rows: [PolicyKey, string, string, string][] = [
    [
      "enforceMfa",
      "Required two-factor authentication",
      "spaceAdmin.mfaRequired",
      "spaceAdmin.mfaOptional",
    ],
    [
      "enforceSso",
      "Single sign-on (SSO)",
      "spaceAdmin.ssoRequired",
      "spaceAdmin.ssoOptional",
    ],
    [
      "disablePublicSharing",
      "Public sharing",
      "spaceAdmin.sharingDenied",
      "spaceAdmin.sharingAllowed",
    ],
  ];
  const save = () =>
    void form.save(async (value, initial) => {
      const patch = Object.fromEntries(
        rows
          .filter(([key]) => value[key] !== initial[key])
          .map(([key]) => [key, value[key]]),
      );
      await mutation.mutateAsync({ spaceId: space.id, ...patch });
      return value;
    });
  const submit = () => {
    const changes = rows.filter(
      ([key]) => form.value[key] !== form.initial[key],
    );
    const deletesShares = changes.some(
      ([key]) =>
        key === "disablePublicSharing" &&
        !(form.initial[key] ?? defaults[key]) &&
        (form.value[key] ?? defaults[key]),
    );
    const loosens = changes.some(
      ([key]) =>
        (form.initial[key] ?? defaults[key]) &&
        !(form.value[key] ?? defaults[key]),
    );
    if (!deletesShares && !loosens) {
      save();
      return;
    }
    modals.openConfirmModal({
      title: t("spaceAdmin.confirmPolicy"),
      children: (
        <Stack>
          {deletesShares && (
            <Text>
              {t("All existing shared links in this space will be deleted.")}
            </Text>
          )}
          {loosens && (
            <Text>
              {t(
                "This change makes the space policy less strict than its current effective value.",
              )}
            </Text>
          )}
        </Stack>
      ),
      labels: { confirm: t("Save"), cancel: t("Cancel") },
      confirmProps: { color: "orange" },
      onConfirm: save,
    });
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Stack gap="lg">
        <Text c="dimmed" size="sm">
          {t(
            "Space policies inherit workspace defaults unless an override is selected.",
          )}
        </Text>
        {rows.map(([key, label, yes, no]) => (
          <Paper withBorder p="md" key={key}>
            <Select
              label={t(label)}
              value={
                form.value[key] === null
                  ? "inherit"
                  : form.value[key]
                    ? "true"
                    : "false"
              }
              data={[
                {
                  value: "inherit",
                  label: t("spaceAdmin.inheritValue", {
                    value: t(defaults[key] ? yes : no),
                  }),
                  disabled: !canLoosen,
                },
                { value: "true", label: t(yes) },
                { value: "false", label: t(no), disabled: !canLoosen },
              ]}
              disabled={form.pending}
              allowDeselect={false}
              onChange={(value) =>
                form.setValue({
                  ...form.value,
                  [key]: value === "inherit" ? null : value === "true",
                })
              }
            />
            <Text size="sm" mt="xs">
              {t("spaceAdmin.currentValue", {
                value: t(
                  (space.policy?.effective[key] ?? defaults[key]) ? yes : no,
                ),
              })}
            </Text>
            {form.dirty && (
              <Text size="sm" mt="xs">
                {t("spaceAdmin.afterSave", {
                  value: t((form.value[key] ?? defaults[key]) ? yes : no),
                })}
              </Text>
            )}
          </Paper>
        ))}
        {!canLoosen && (
          <Text size="sm" c="dimmed">
            {t(
              "Space administrators cannot weaken an effective security policy.",
            )}
          </Text>
        )}
      </Stack>
      <SettingsSaveBar {...form} onCancel={form.reset} />
    </form>
  );
}

export function SpaceNavigationSettings({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const mutation = useUpdateSpaceMutation();
  const form = useSettingsDraft<ISpaceCustomLink[]>(
    space.settings?.customLinks?.links ?? [],
  );
  const [editing, setEditing] = useState<ISpaceCustomLink | "new" | null>(null);
  const move = (index: number, delta: number) => {
    const next = [...form.value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    form.setValue(next);
  };
  const apply = (value: CustomLinkFormValue) => {
    form.setValue(
      editing === "new"
        ? [...form.value, { id: crypto.randomUUID(), ...value }]
        : form.value.map((link) =>
            link.id === editing?.id ? { ...link, ...value } : link,
          ),
    );
    setEditing(null);
  };
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.save(async (links) => {
            await mutation.mutateAsync({
              spaceId: space.id,
              customLinks: { links },
            });
            return links;
          });
        }}
      >
        <Stack>
          {form.value.length === 0 && (
            <Text c="dimmed">{t("spaceAdmin.noLinks")}</Text>
          )}
          {form.value.map((link, index) => {
            const Icon = getCustomLinkIcon(link.icon);
            return (
              <Paper withBorder p="sm" key={link.id} className={classes.row}>
                <Icon size={20} />
                <div className={classes.rowContent}>
                  <Text fw={500}>{link.label}</Text>
                  <Text size="xs" c="dimmed">
                    {link.url}
                  </Text>
                </div>
                <Group gap={2}>
                  <AccessibleActionIcon
                    label={t("spaceAdmin.moveUp")}
                    disabled={index === 0 || form.pending}
                    onClick={() => move(index, -1)}
                  >
                    <IconArrowUp size={16} />
                  </AccessibleActionIcon>
                  <AccessibleActionIcon
                    label={t("spaceAdmin.moveDown")}
                    disabled={index === form.value.length - 1 || form.pending}
                    onClick={() => move(index, 1)}
                  >
                    <IconArrowDown size={16} />
                  </AccessibleActionIcon>
                  <AccessibleActionIcon
                    label={t("Edit")}
                    disabled={form.pending}
                    onClick={() => setEditing(link)}
                  >
                    <IconEdit size={16} />
                  </AccessibleActionIcon>
                  <AccessibleActionIcon
                    label={t("Delete")}
                    disabled={form.pending}
                    onClick={() =>
                      form.setValue(
                        form.value.filter((item) => item.id !== link.id),
                      )
                    }
                  >
                    <IconTrash size={16} />
                  </AccessibleActionIcon>
                </Group>
              </Paper>
            );
          })}
          <Button
            variant="light"
            disabled={form.pending}
            onClick={() => setEditing("new")}
          >
            {t("spaceAdmin.addLink")}
          </Button>
        </Stack>
        <SettingsSaveBar {...form} onCancel={form.reset} />
      </form>
      <CustomLinkFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        onSubmit={apply}
        isPending={false}
        initialValue={editing && editing !== "new" ? editing : undefined}
      />
    </>
  );
}

export function SpaceMaintenanceSettings({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const archive = useArchiveSpaceMutation();
  const unarchive = useUnarchiveSpaceMutation();
  const [exportOpened, setExportOpened] = useState(false);
  const toggle = () =>
    modals.openConfirmModal({
      title: t(space.archivedAt ? "Unarchive space" : "Archive space"),
      children: (
        <Text>
          {t(
            space.archivedAt
              ? "Unarchive space confirmation"
              : "Archive space confirmation",
            { spaceName: space.name },
          )}
        </Text>
      ),
      labels: {
        confirm: t(space.archivedAt ? "Unarchive" : "Archive"),
        cancel: t("Cancel"),
      },
      onConfirm: () =>
        space.archivedAt
          ? unarchive.mutate(space.id)
          : archive.mutate(space.id),
    });
  return (
    <Stack gap="lg">
      <div>
        <Text fw={600}>{t("Export space")}</Text>
        <Text c="dimmed" size="sm" mb="sm">
          {t("Export all pages and attachments in this space.")}
        </Text>
        <Button variant="light" onClick={() => setExportOpened(true)}>
          {t("Export")}
        </Button>
      </div>
      <Divider />
      <div>
        <Text fw={600}>
          {t(space.archivedAt ? "Unarchive space" : "Archive space")}
        </Text>
        <Text c="dimmed" size="sm" mb="sm">
          {t(
            space.archivedAt
              ? "Unarchive this space and restore editing."
              : "Archive this space and make its content read-only.",
          )}
        </Text>
        <Button
          variant="light"
          color="orange"
          c="var(--mantine-color-text)"
          loading={archive.isPending || unarchive.isPending}
          onClick={toggle}
        >
          {t(space.archivedAt ? "Unarchive" : "Archive")}
        </Button>
      </div>
      <Divider />
      <Alert
        color="red"
        title={t("Delete space")}
        styles={{ title: { color: "var(--mantine-color-text)" } }}
      >
        <Text size="sm" mb="md">
          {t("Delete this space with all its pages and data.")}
        </Text>
        <DeleteSpaceModal space={space} returnTo="/settings/spaces" />
      </Alert>
      <ExportModal
        type="space"
        id={space.id}
        open={exportOpened}
        onClose={() => setExportOpened(false)}
      />
    </Stack>
  );
}
