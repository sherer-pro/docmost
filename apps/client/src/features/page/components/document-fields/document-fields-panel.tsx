import React, { useEffect, useMemo, useState } from "react";
import {
  alpha,
  ActionIcon,
  Badge,
  Group,
  Paper,
  Select,
  SelectProps,
  Stack,
  Table,
  Text,
  Tooltip,
  useMantineTheme,
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
  { value: PageCustomFieldStatus.TODO, label: "TODO", color: "gray" },
  { value: PageCustomFieldStatus.IN_PROGRESS, label: "In progress", color: "blue" },
  { value: PageCustomFieldStatus.IN_REVIEW, label: "In review", color: "indigo" },
  { value: PageCustomFieldStatus.DONE, label: "Done", color: "green" },
  { value: PageCustomFieldStatus.REJECTED, label: "Rejected", color: "red" },
  { value: PageCustomFieldStatus.ARCHIVED, label: "Archived", color: "dark" },
];

/**
 * Normalizes page custom fields into a fully populated structure,
 * so all controls remain controlled in read/edit modes and do not break on null/undefined.
 */
function normalizeCustomFields(customFields?: PageCustomFields): Required<PageCustomFields> {
  return {
    status: customFields?.status ?? null,
    assigneeId: customFields?.assigneeId ?? null,
    stakeholderIds: customFields?.stakeholderIds ?? [],
  };
}

export function DocumentFieldsPanel({ page, readOnly }: DocumentFieldsPanelProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const currentUser = useAtomValue(currentUserAtom);
  const documentFields = page.space?.settings?.documentFields;
  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;
  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

  const enabledFields = useMemo(
    () => ({
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
    mutate(nextFields);
  }, 600);

  /**
   * Locally updates field state and triggers deferred save only when
   * the document is actually editable (not readOnly and user is in Edit mode).
   */
  const handleFieldChange = (nextFields: Required<PageCustomFields>) => {
    setFields(nextFields);

    if (!isEditable) {
      return;
    }

    debouncedSave(nextFields);
  };

  const selectedStatus = STATUS_OPTIONS.find((item) => item.value === fields.status);

  /**
   * Computes status field styles based on the selected badge color,
   * so the current document state is visually highlighted immediately.
   */
  const statusInputStyles = useMemo(() => {
    if (!selectedStatus) {
      return undefined;
    }

    const colorScale = theme.colors[selectedStatus.color] ?? theme.colors.gray;

    return {
      input: {
        backgroundColor: alpha(colorScale[1], 0.35),
        borderColor: colorScale[4],
      },
    };
  }, [selectedStatus, theme.colors]);

  const renderStatusOption: SelectProps["renderOption"] = ({ option }) => {
    const selected = STATUS_OPTIONS.find((item) => item.value === option.value);

    if (!selected) {
      return <Text size="sm">{option.label}</Text>;
    }

    return (
      <Badge color={selected.color} variant="light">
        {t(option.label)}
      </Badge>
    );
  };

  /**
   * Standardizes rendering of the field name in the left table column,
   * including a tooltip with a short description of the field purpose.
   */
  const renderFieldLabel = (label: string, tooltip: string, ariaLabel: string) => (
    <Group gap={6} wrap="nowrap">
      <Text size="sm" fw={600}>{t(label)}</Text>
      <Tooltip multiline w={300} label={t(tooltip)}>
        <ActionIcon variant="subtle" size="sm" aria-label={t(ariaLabel)}>
          <IconInfoCircle size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  if (!enabledFields.status && !enabledFields.assignee && !enabledFields.stakeholders) {
    return null;
  }

  return (
    <Group mx={{ base: 0, sm: 'md' }}>
    <Paper withBorder radius="md" my="md"  mx={{ base: 0, sm: 'xl' }}>
      <Table withColumnBorders verticalSpacing="xs" horizontalSpacing="sm" layout="fixed">
        <Table.Tbody>
          {enabledFields.status && (
            <Table.Tr>
              <Table.Td w="38%" visibleFrom="sm">
                {renderFieldLabel(
                  "Status",
                  "Shows the current lifecycle stage of the document. Use this field to make progress transparent for everyone in the space.",
                  "Status info",
                )}
              </Table.Td>
              <Table.Td>
                {readOnly ? (
                  selectedStatus ? (
                    <Badge color={selectedStatus.color} variant="light">
                      {t(selectedStatus.label)}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">{t("no data")}</Text>
                  )
                ) : (
                  <Select
                    data={STATUS_OPTIONS.map((item) => ({ value: item.value, label: t(item.label) }))}
                    value={fields.status}
                    onChange={(value) =>
                      handleFieldChange({ ...fields, status: (value as PageCustomFieldStatus) || null })
                    }
                    placeholder={t("Select status")}
                    clearable
                    renderOption={renderStatusOption}
                    styles={statusInputStyles}
                  />
                )}
              </Table.Td>
            </Table.Tr>
          )}

          {enabledFields.assignee && (
            <Table.Tr>
              <Table.Td visibleFrom="sm">
                {renderFieldLabel(
                  "Assignee",
                  "The assignee is the space member responsible for keeping this document up to date and driving work to completion.",
                  "Assignee info",
                )}
              </Table.Td>
              <Table.Td>
                {readOnly ? (
                  fields.assigneeId ? (
                    <Group gap="xs" wrap="nowrap">
                      <CustomAvatar
                        avatarUrl={knownUsersById[fields.assigneeId]?.avatarUrl}
                        size={18}
                        name={knownUsersById[fields.assigneeId]?.label ?? fields.assigneeId}
                      />
                      <Text size="sm">{knownUsersById[fields.assigneeId]?.label ?? fields.assigneeId}</Text>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">{t("no data")}</Text>
                  )
                ) : (
                  <AssigneeSpaceMemberSelect
                    spaceId={page.spaceId}
                    value={fields.assigneeId}
                    onChange={(value) => handleFieldChange({ ...fields, assigneeId: value })}
                  />
                )}
              </Table.Td>
            </Table.Tr>
          )}

          {enabledFields.stakeholders && (
            <Table.Tr>
              <Table.Td visibleFrom="sm">
                {renderFieldLabel(
                  "Stakeholders",
                  "Stakeholders are space members who are affected by this document, contribute context, or should be notified about important changes.",
                  "Stakeholders info",
                )}
              </Table.Td>
              <Table.Td>
                {readOnly ? (
                  fields.stakeholderIds.length ? (
                    <Stack gap="xs">
                      {fields.stakeholderIds.map((id) => (
                        <Group key={id} gap="xs" wrap="nowrap">
                          <CustomAvatar avatarUrl={knownUsersById[id]?.avatarUrl} size={18} name={knownUsersById[id]?.label ?? id} />
                          <Text size="sm">{knownUsersById[id]?.label ?? id}</Text>
                        </Group>
                      ))}
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">{t("no data")}</Text>
                  )
                ) : (
                  <StakeholdersSpaceMemberMultiSelect
                    spaceId={page.spaceId}
                    value={fields.stakeholderIds}
                    onChange={(value) => handleFieldChange({ ...fields, stakeholderIds: value })}
                  />
                )}
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Paper>
    </Group>
  );
}

export default DocumentFieldsPanel;
