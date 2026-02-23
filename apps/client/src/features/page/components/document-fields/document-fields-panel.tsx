import React, { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Select,
  SelectProps,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useDebouncedCallback } from "@mantine/hooks";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { updatePage } from "@/features/page/services/page-service.ts";
import {
  IPage,
  PageCustomFields,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import { queryClient } from "@/main.tsx";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useAtomValue } from "jotai";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { AssigneeSpaceMemberSelect } from "@/features/page/components/document-fields/assignee-space-member-select.tsx";
import { StakeholdersSpaceMemberMultiSelect } from "@/features/page/components/document-fields/stakeholders-space-member-multiselect.tsx";
import { useSpaceMemberSelectOptions } from "@/features/page/components/document-fields/space-member-select-utils.ts";

interface DocumentFieldsPanelProps {
  page: IPage;
  readOnly: boolean;
}

const STATUS_OPTIONS: { value: PageCustomFieldStatus; label: string; color: string }[] = [
  // Status values are persisted as enum constants; labels are source i18n keys.
  { value: PageCustomFieldStatus.TODO, label: "TODO", color: "gray" },
  { value: PageCustomFieldStatus.IN_PROGRESS, label: "In progress", color: "blue" },
  { value: PageCustomFieldStatus.IN_REVIEW, label: "In review", color: "indigo" },
  { value: PageCustomFieldStatus.DONE, label: "Done", color: "green" },
  { value: PageCustomFieldStatus.REJECTED, label: "Rejected", color: "red" },
  { value: PageCustomFieldStatus.ARCHIVED, label: "Archived", color: "dark" },
];


function normalizeCustomFields(customFields?: PageCustomFields): Required<PageCustomFields> {
  // Normalize nullable API fields to a stable controlled-component shape.
  return {
    status: customFields?.status ?? null,
    assigneeId: customFields?.assigneeId ?? null,
    stakeholderIds: customFields?.stakeholderIds ?? [],
  };
}

export function DocumentFieldsPanel({ page, readOnly }: DocumentFieldsPanelProps) {
  const { t } = useTranslation();
  const currentUser = useAtomValue(currentUserAtom);
  const documentFields = page.space?.settings?.documentFields;
  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;
  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

  const enabledFields = useMemo(
    () => ({
      // Render only fields enabled in space-level settings.
      status: !!documentFields?.status,
      assignee: !!documentFields?.assignee,
      stakeholders: !!documentFields?.stakeholders,
    }),
    [documentFields],
  );

  const [fields, setFields] = useState<Required<PageCustomFields>>(
    normalizeCustomFields(page.customFields),
  );

  const selectedMemberIds = useMemo(
    () => [...(fields.assigneeId ? [fields.assigneeId] : []), ...fields.stakeholderIds],
    [fields.assigneeId, fields.stakeholderIds],
  );

  const { knownUsersById } = useSpaceMemberSelectOptions(page.spaceId, selectedMemberIds);

  useEffect(() => {
    setFields(normalizeCustomFields(page.customFields));
  }, [page.customFields, page.id]);

  const { mutate } = useMutation({
    mutationFn: (nextFields: Required<PageCustomFields>) =>
      updatePage({ pageId: page.id, customFields: nextFields }),
    onSuccess: (updatedPage) => {
      queryClient.setQueryData(["pages", updatedPage.id], updatedPage);
      queryClient.setQueryData(["pages", updatedPage.slugId], updatedPage);
    },
  });

  const debouncedSave = useDebouncedCallback((nextFields: Required<PageCustomFields>) => {
    // Debounce limits API calls during rapid user edits.
    mutate(nextFields);
  }, 600);

  const handleFieldChange = (nextFields: Required<PageCustomFields>) => {
    setFields(nextFields);

    if (!isEditable) {
      return;
    }

    debouncedSave(nextFields);
  };

  if (!enabledFields.status && !enabledFields.assignee && !enabledFields.stakeholders) {
    return null;
  }

  /**
   * Resolves currently selected status metadata to keep rendering logic
   * deterministic in both read and edit modes.
   */
  const selectedStatus = STATUS_OPTIONS.find((item) => item.value === fields.status);

  const renderStatusOption: SelectProps["renderOption"] = ({ option }) => {
    const selected = STATUS_OPTIONS.find((item) => item.value === option.value);

    if (!selected) {
      return <Text size="sm">{t(option.label)}</Text>;
    }

    return (
      <Group justify="space-between" w="100%" wrap="nowrap">
        <Text size="sm">{t(option.label)}</Text>
        <Badge color={selected.color} variant="light">{t(option.label)}</Badge>
      </Group>
    );
  };

  return (
    <Paper withBorder radius="md" p="sm" my="sm">
      <Table withRowBorders={false} verticalSpacing="xs" horizontalSpacing="sm">
        <Table.Tbody>
          {enabledFields.status && (
            <Table.Tr>
              <Table.Td w={180}>
                <Group gap={6}>
                  <Text size="sm" fw={600}>{t("Status")}</Text>
                  <Tooltip
                    multiline
                    w={300}
                    label={t(
                      "Shows the current lifecycle stage of the document. Use this field to make progress transparent for everyone in the space.",
                    )}
                  >
                    <ActionIcon variant="subtle" size="sm" aria-label={t("Status info")}>
                      <IconInfoCircle size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
              <Table.Td>
                {!isEditable ? (
                  selectedStatus ? (
                    <Badge color={selectedStatus.color} variant="light">{t(selectedStatus.label)}</Badge>
                  ) : (
                    <Text size="sm" c="dimmed">{t("no data")}</Text>
                  )
                ) : (
                  <Select
                    data={STATUS_OPTIONS.map((item) => ({ value: item.value, label: t(item.label) }))}
                    value={fields.status}
                    onChange={(value) => handleFieldChange({ ...fields, status: (value as PageCustomFieldStatus) || null })}
                    placeholder={t("Select status")}
                    clearable
                    renderOption={renderStatusOption}
                    leftSection={
                      selectedStatus ? (
                        <Badge color={selectedStatus.color} variant="light" size="xs">
                          {t(selectedStatus.label)}
                        </Badge>
                      ) : undefined
                    }
                  />
                )}
              </Table.Td>
            </Table.Tr>
          )}

          {enabledFields.assignee && (
            <Table.Tr>
              <Table.Td>
                <Group gap={6}>
                  <Text size="sm" fw={600}>{t("Assignee")}</Text>
                  <Tooltip multiline w={300} label={t("The assignee is the space member responsible for keeping this document up to date and driving work to completion.")}>
                    <ActionIcon variant="subtle" size="sm" aria-label={t("Assignee info")}>
                      <IconInfoCircle size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
              <Table.Td>
                {!isEditable ? (
                  fields.assigneeId ? (
                    <Group gap="xs" wrap="nowrap">
                      <CustomAvatar avatarUrl={knownUsersById[fields.assigneeId]?.avatarUrl} size={18} name={knownUsersById[fields.assigneeId]?.label ?? fields.assigneeId} />
                      <Text size="sm">{knownUsersById[fields.assigneeId]?.label ?? fields.assigneeId}</Text>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">{t("no data")}</Text>
                  )
                ) : (
                  <AssigneeSpaceMemberSelect spaceId={page.spaceId} value={fields.assigneeId} onChange={(value) => handleFieldChange({ ...fields, assigneeId: value })} />
                )}
              </Table.Td>
            </Table.Tr>
          )}

          {enabledFields.stakeholders && (
            <Table.Tr>
              <Table.Td>
                <Group gap={6}>
                  <Text size="sm" fw={600}>{t("Stakeholders")}</Text>
                  <Tooltip multiline w={300} label={t("Stakeholders are space members who are affected by this document, contribute context, or should be notified about important changes.")}>
                    <ActionIcon variant="subtle" size="sm" aria-label={t("Stakeholders info")}>
                      <IconInfoCircle size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
              <Table.Td>
                {!isEditable ? (
                  fields.stakeholderIds.length ? (
                    <div style={{ display: "grid", gap: "6px" }}>
                      {fields.stakeholderIds.map((id) => (
                        <Group key={id} gap="xs" wrap="nowrap">
                          <CustomAvatar avatarUrl={knownUsersById[id]?.avatarUrl} size={18} name={knownUsersById[id]?.label ?? id} />
                          <Text size="sm">{knownUsersById[id]?.label ?? id}</Text>
                        </Group>
                      ))}
                    </div>
                  ) : (
                    <Text size="sm" c="dimmed">{t("no data")}</Text>
                  )
                ) : (
                  <StakeholdersSpaceMemberMultiSelect spaceId={page.spaceId} value={fields.stakeholderIds} onChange={(value) => handleFieldChange({ ...fields, stakeholderIds: value })} />
                )}
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

export default DocumentFieldsPanel;
