import React, { useState } from "react";
import {
  useSpaceQuery,
  useUpdateSpaceMutation,
} from "@/features/space/queries/space-query.ts";
import { EditSpaceForm } from "@/features/space/components/edit-space-form.tsx";
import {
  ActionIcon,
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
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import { queryClient } from "@/main.tsx";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row.tsx";
import SpacePublicSharingToggle from "@/ee/security/components/space-public-sharing-toggle.tsx";
import useEnterpriseAccess from "@/ee/hooks/use-enterprise-access.tsx";
import { IconInfoCircle } from "@tabler/icons-react";
import { ISpaceDocumentFieldsSettings } from "@/features/space/types/space.types.ts";

interface SpaceDetailsProps {
  spaceId: string;
  readOnly?: boolean;
}
export default function SpaceDetails({ spaceId, readOnly }: SpaceDetailsProps) {
  const { t } = useTranslation();
  const { data: space, isLoading, refetch } = useSpaceQuery(spaceId);
  const { mutate: updateSpace, isPending: isUpdatingSpace } =
    useUpdateSpaceMutation();
  const hasEnterpriseAccess = useEnterpriseAccess();
  const showSharingToggle = !readOnly && hasEnterpriseAccess;
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [isIconUploading, setIsIconUploading] = useState(false);

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

  return (
    <>
      {space && (
        <div>
          <Text my="md" fw={600}>
            {t("Details")}
          </Text>

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
                  <Tooltip label={t("Show document status field")}>
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
                  <Tooltip label={t("Show assignee field")}>
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
                  <Tooltip label={t("Show stakeholders field")}>
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
                  <Text size="md">{t("Export space")}</Text>
                  <Text size="sm" c="dimmed">
                    {t("Export all pages and attachments in this space.")}
                  </Text>
                </ResponsiveSettingsContent>
                <ResponsiveSettingsControl>
                  <Button onClick={openExportModal}>{t("Export")}</Button>
                </ResponsiveSettingsControl>
              </ResponsiveSettingsRow>

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

              <ExportModal
                type="space"
                id={space.id}
                open={exportOpened}
                onClose={closeExportModal}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
