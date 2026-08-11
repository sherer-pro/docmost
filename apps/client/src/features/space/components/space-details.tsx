import React, { useState } from "react";
import {
  useSpaceQuery,
  useArchiveSpaceMutation,
  useUnarchiveSpaceMutation,
  useUpdateSpaceMutation,
} from "@/features/space/queries/space-query.ts";
import { EditSpaceForm } from "@/features/space/components/edit-space-form.tsx";
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Divider,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import DeleteSpaceModal from "./delete-space-modal";
import { useDisclosure } from "@mantine/hooks";
import ExportModal from "@/components/common/export-modal.tsx";
import AvatarUploader from "@/components/common/avatar-uploader.tsx";
import {
  uploadSpaceIcon,
  removeSpaceIcon,
} from "@/features/attachments/services/attachment-service.ts";
import { useTranslation } from "react-i18next";
import { modals } from "@mantine/modals";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import { queryClient } from "@/main.tsx";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row.tsx";
import SpacePublicSharingToggle from "@/features/security/components/space-public-sharing-toggle.tsx";
import {
  IconArchive,
  IconArchiveOff,
  IconInfoCircle,
} from "@tabler/icons-react";
import { ISpaceDocumentFieldsSettings } from "@/features/space/types/space.types.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { useAtomValue } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { hasFullSpaceAccess } from "@/features/space/permissions/export-access.ts";
import { PageTemplateSpacePolicySettings } from "@/features/page-template/components/page-template-policy-settings";
import SpaceLabelsSettings from "@/features/label/components/space-labels-settings";

interface SpaceDetailsProps {
  spaceId: string;
  readOnly?: boolean;
}
export default function SpaceDetails({ spaceId, readOnly }: SpaceDetailsProps) {
  const { t } = useTranslation();
  const user = useAtomValue(userAtom);
  const { data: space, isLoading, refetch } = useSpaceQuery(spaceId);
  const { mutate: updateSpace, isPending: isUpdatingSpace } =
    useUpdateSpaceMutation();
  const { mutateAsync: archiveSpace, isPending: isArchivingSpace } =
    useArchiveSpaceMutation();
  const { mutateAsync: unarchiveSpace, isPending: isUnarchivingSpace } =
    useUnarchiveSpaceMutation();
  const showSharingToggle = !readOnly;
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [isIconUploading, setIsIconUploading] = useState(false);
  const isArchived = !!space?.archivedAt;
  const canExportSpace = hasFullSpaceAccess({
    workspaceRole: user?.role,
    spaceRole: space?.membership?.role,
  });

  const handleIconUpload = async (file: File) => {
    setIsIconUploading(true);
    try {
      await uploadSpaceIcon(file, spaceId);
      await refetch();
      await queryClient.invalidateQueries({
        predicate: (item) => ["spaces"].includes(item.queryKey[0] as string),
      });
    } catch (err) {
      // skip
    } finally {
      setIsIconUploading(false);
    }
  };

  const handleIconRemove = async () => {
    setIsIconUploading(true);
    try {
      await removeSpaceIcon(spaceId);
      await refetch();
      await queryClient.invalidateQueries({
        predicate: (item) => ["spaces"].includes(item.queryKey[0] as string),
      });
    } catch (err) {
      // skip
    } finally {
      setIsIconUploading(false);
    }
  };

  const handleDocumentFieldChange = (
    field: keyof ISpaceDocumentFieldsSettings,
    checked: boolean,
  ) => {
    // Update only document field configuration while preserving other space settings.
    if (!space || readOnly) {
      return;
    }

    updateSpace({
      spaceId,
      documentFields: {
        ...space.settings?.documentFields,
        [field]: checked,
      },
    });
  };

  const handleDictionaryEnabledChange = (checked: boolean) => {
    if (!space || readOnly) {
      return;
    }

    updateSpace({
      spaceId,
      dictionaryEnabled: checked,
    });
  };

  const handleHeadingNumberingEnabledChange = (checked: boolean) => {
    if (!space || readOnly) {
      return;
    }

    updateSpace({
      spaceId,
      headingNumberingEnabled: checked,
    });
  };

  const handleArchiveToggle = () => {
    if (!space || readOnly) {
      return;
    }

    modals.openConfirmModal({
      title: isArchived ? t("Unarchive space") : t("Archive space"),
      children: (
        <Text size="sm">
          {isArchived
            ? t("Unarchive space confirmation", { spaceName: space.name })
            : t("Archive space confirmation", { spaceName: space.name })}
        </Text>
      ),
      labels: {
        confirm: isArchived ? t("Unarchive") : t("Archive"),
        cancel: t("Cancel"),
      },
      confirmProps: {
        color: isArchived ? "blue" : "orange",
      },
      onConfirm: () =>
        isArchived ? unarchiveSpace(space.id) : archiveSpace(space.id),
    });
  };

  return (
    <>
      {space && (
        <div>
          <Text my="md" fw={600}>
            {t("Details")}
          </Text>

          {isArchived && (
            <Alert color="yellow" variant="light" my="md">
              {t("This space is archived and content is read-only.")}
            </Alert>
          )}

          <div style={{ marginBottom: "20px" }}>
            <Text size="sm" fw={500} mb="xs">
              {t("Icon")}
            </Text>
            <AvatarUploader
              currentImageUrl={space.logo}
              fallbackName={space.name}
              size={"60px"}
              variant="filled"
              type={AvatarIconType.SPACE_ICON}
              onUpload={handleIconUpload}
              onRemove={handleIconRemove}
              isLoading={isIconUploading}
              disabled={readOnly}
            />
          </div>

          <EditSpaceForm space={space} readOnly={readOnly} />

          {showSharingToggle && (
            <>
              <Divider my="lg" />
              <SpacePublicSharingToggle space={space} />
            </>
          )}

          {!readOnly && (
            <>
              <Divider my="lg" />
              <PageTemplateSpacePolicySettings
                spaceId={spaceId}
                readOnly={readOnly}
              />
            </>
          )}

          <Divider my="lg" />

          {!readOnly && <SpaceLabelsSettings spaceId={spaceId} />}

          {!readOnly && <Divider my="lg" />}

          <ResponsiveSettingsRow>
            <ResponsiveSettingsContent>
              <Text size="md">{t("Dictionary")}</Text>
              <Text size="sm" c="dimmed">
                {t("Highlight dictionary terms in pages and databases.")}
              </Text>
            </ResponsiveSettingsContent>
            <ResponsiveSettingsControl>
              <Checkbox
                label={t("Enable dictionary")}
                checked={!!space.settings?.dictionary?.enabled}
                onChange={(event) =>
                  handleDictionaryEnabledChange(event.currentTarget.checked)
                }
                disabled={readOnly || isUpdatingSpace}
              />
            </ResponsiveSettingsControl>
          </ResponsiveSettingsRow>

          <Divider my="lg" />

          <ResponsiveSettingsRow>
            <ResponsiveSettingsContent>
              <Text size="md">{t("Heading numbering")}</Text>
              <Text size="sm" c="dimmed">
                {t("Automatically number H1-H3 headings in this space.")}
              </Text>
            </ResponsiveSettingsContent>
            <ResponsiveSettingsControl>
              <Checkbox
                label={t("Number headings")}
                checked={!!space.settings?.headingNumbering?.enabled}
                onChange={(event) =>
                  handleHeadingNumberingEnabledChange(
                    event.currentTarget.checked,
                  )
                }
                disabled={readOnly || isUpdatingSpace}
              />
            </ResponsiveSettingsControl>
          </ResponsiveSettingsRow>

          <Divider my="lg" />

          <ResponsiveSettingsRow>
            <ResponsiveSettingsContent>
              <Text size="md">{t("Custom document fields")}</Text>
            </ResponsiveSettingsContent>
            <ResponsiveSettingsControl>
              <Stack gap="xs">
                <Group gap="xs" wrap="nowrap">
                  <Checkbox
                    label={t("Document status")}
                    checked={!!space.settings?.documentFields?.status}
                    onChange={(event) =>
                      handleDocumentFieldChange(
                        "status",
                        event.currentTarget.checked,
                      )
                    }
                    disabled={readOnly || isUpdatingSpace}
                  />
                  <Tooltip
                    multiline
                    w={320}
                    label={t(
                      "Adds a status field to every document in this space. The status can be used to track work stages such as TODO, In progress, In review, Done, Rejected, or Archived.",
                    )}
                  >
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t("Document status info")}
                    >
                      <IconInfoCircle size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

                <Group gap="xs" wrap="nowrap">
                  <Checkbox
                    label={t("Reading time")}
                    checked={!!space.settings?.documentFields?.readingTime}
                    onChange={(event) =>
                      handleDocumentFieldChange(
                        "readingTime",
                        event.currentTarget.checked,
                      )
                    }
                    disabled={readOnly || isUpdatingSpace}
                  />
                  <AccessibleActionIcon
                    variant="subtle"
                    label={t("Reading time info")}
                    tooltip={t(
                      "Estimates reading time from the document text and shows it below the title.",
                    )}
                    tooltipProps={{ multiline: true, w: 320 }}
                  >
                    <IconInfoCircle size={16} />
                  </AccessibleActionIcon>
                </Group>

                <Group gap="xs" wrap="nowrap">
                  <Checkbox
                    label={t("Assignee")}
                    checked={!!space.settings?.documentFields?.assignee}
                    onChange={(event) =>
                      handleDocumentFieldChange(
                        "assignee",
                        event.currentTarget.checked,
                      )
                    }
                    disabled={readOnly || isUpdatingSpace}
                  />
                  <Tooltip
                    multiline
                    w={320}
                    label={t(
                      "Adds an assignee field to every document. The assignee can be selected only from members of this space.",
                    )}
                  >
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t("Assignee info")}
                    >
                      <IconInfoCircle size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

                <Group gap="xs" wrap="nowrap">
                  <Checkbox
                    label={t("AI role")}
                    checked={!!space.settings?.documentFields?.aiRole}
                    onChange={(event) =>
                      handleDocumentFieldChange(
                        "aiRole",
                        event.currentTarget.checked,
                      )
                    }
                    disabled={readOnly || isUpdatingSpace}
                  />
                  <Tooltip
                    multiline
                    w={320}
                    label={t(
                      "Adds an AI role field to every document in this space. Use it to disclose the role AI played in each document.",
                    )}
                  >
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t("AI role info")}
                    >
                      <IconInfoCircle size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

                <Group gap="xs" wrap="nowrap">
                  <Checkbox
                    label={t("Stakeholders")}
                    checked={!!space.settings?.documentFields?.stakeholders}
                    onChange={(event) =>
                      handleDocumentFieldChange(
                        "stakeholders",
                        event.currentTarget.checked,
                      )
                    }
                    disabled={readOnly || isUpdatingSpace}
                  />
                  <Tooltip
                    multiline
                    w={320}
                    label={t(
                      "Adds a stakeholders field to every document. Stakeholders are selected from space members and can include multiple people.",
                    )}
                  >
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t("Stakeholders info")}
                    >
                      <IconInfoCircle size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Stack>
            </ResponsiveSettingsControl>
          </ResponsiveSettingsRow>

          {!readOnly && (
            <>
              <Divider my="lg" />

              <ResponsiveSettingsRow>
                <ResponsiveSettingsContent>
                  <Text size="md">
                    {isArchived ? t("Unarchive space") : t("Archive space")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {isArchived
                      ? t("Unarchive this space and restore editing.")
                      : t(
                          "Archive this space and make its content read-only.",
                        )}
                  </Text>
                </ResponsiveSettingsContent>
                <ResponsiveSettingsControl>
                  <Button
                    color={isArchived ? "blue" : "orange"}
                    variant={isArchived ? "filled" : "light"}
                    leftSection={
                      isArchived ? (
                        <IconArchiveOff size={16} />
                      ) : (
                        <IconArchive size={16} />
                      )
                    }
                    loading={isArchivingSpace || isUnarchivingSpace}
                    onClick={handleArchiveToggle}
                  >
                    {isArchived ? t("Unarchive") : t("Archive")}
                  </Button>
                </ResponsiveSettingsControl>
              </ResponsiveSettingsRow>
            </>
          )}

          {canExportSpace && (
            <>
              <Divider my="lg" />

              <ResponsiveSettingsRow>
                <ResponsiveSettingsContent>
                  <Text size="md">{t("Export space")}</Text>
                  <Text size="sm" c="dimmed">
                    {t("Export all pages and attachments in this space.")}
                  </Text>
                </ResponsiveSettingsContent>
                <ResponsiveSettingsControl>
                  <Button onClick={openExportModal}>{t("Export")}</Button>
                </ResponsiveSettingsControl>
              </ResponsiveSettingsRow>
            </>
          )}

          {!readOnly && (
            <>
              <Divider my="lg" />

              <ResponsiveSettingsRow>
                <ResponsiveSettingsContent>
                  <Text size="md">{t("Delete space")}</Text>
                  <Text size="sm" c="dimmed">
                    {t("Delete this space with all its pages and data.")}
                  </Text>
                </ResponsiveSettingsContent>
                <ResponsiveSettingsControl>
                  <DeleteSpaceModal space={space} />
                </ResponsiveSettingsControl>
              </ResponsiveSettingsRow>
            </>
          )}

          {canExportSpace && (
            <ExportModal
              type="space"
              id={space.id}
              open={exportOpened}
              onClose={closeExportModal}
            />
          )}
        </div>
      )}
    </>
  );
}
