import React, { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useDebouncedCallback } from "@mantine/hooks";
import { useMutation } from "@tanstack/react-query";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { updatePage } from "@/features/page/services/page-service.ts";
import {
  IPage,
  PageCustomFields,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import { queryClient } from "@/main.tsx";
import { AssigneeSpaceMemberSelect } from "@/features/page/components/document-fields/assignee-space-member-select.tsx";
import { StakeholdersSpaceMemberMultiSelect } from "@/features/page/components/document-fields/stakeholders-space-member-multiselect.tsx";
import { useSpaceMemberSelectOptions } from "@/features/page/components/document-fields/space-member-select-utils.ts";

interface DocumentFieldsPanelProps {
  page: IPage;
  readOnly: boolean;
}

const STATUS_OPTIONS: { value: PageCustomFieldStatus; label: string; color: string }[] = [
  { value: "not_started", label: "Not started", color: "gray" },
  { value: "in_progress", label: "In progress", color: "blue" },
  { value: "done", label: "Done", color: "green" },
];

function normalizeCustomFields(customFields?: PageCustomFields): Required<PageCustomFields> {
  return {
    status: customFields?.status ?? null,
    assigneeId: customFields?.assigneeId ?? null,
    stakeholderIds: customFields?.stakeholderIds ?? [],
  };
}

export function DocumentFieldsPanel({ page, readOnly }: DocumentFieldsPanelProps) {
  const documentFields = page.space?.settings?.documentFields;

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

  const handleFieldChange = (nextFields: Required<PageCustomFields>) => {
    setFields(nextFields);

    if (readOnly) {
      return;
    }

    debouncedSave(nextFields);
  };

  if (!enabledFields.status && !enabledFields.assignee && !enabledFields.stakeholders) {
    return null;
  }

  const selectedStatus = STATUS_OPTIONS.find((item) => item.value === fields.status);

  return (
    <Paper withBorder radius="md" p="md" my="sm">
      <Stack gap="md">
        {enabledFields.status && (
          <Stack gap={4}>
            <Group gap={6}>
              <Text size="sm" fw={600}>Status</Text>
              <Tooltip label="Current document status">
                <ActionIcon variant="subtle" size="sm" aria-label="Status info">
                  <IconInfoCircle size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>

            {readOnly ? (
              selectedStatus ? (
                <Badge color={selectedStatus.color} variant="light">
                  {selectedStatus.label}
                </Badge>
              ) : (
                <Text size="sm" c="dimmed">no data</Text>
              )
            ) : (
              <Select
                data={STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                value={fields.status}
                onChange={(value) =>
                  handleFieldChange({ ...fields, status: (value as PageCustomFieldStatus) || null })
                }
                placeholder="Select status"
                clearable
              />
            )}
          </Stack>
        )}

        {enabledFields.assignee && (
          <Stack gap={4}>
            <Group gap={6}>
              <Text size="sm" fw={600}>Assignee</Text>
              <Tooltip label="Document owner responsible for updates">
                <ActionIcon variant="subtle" size="sm" aria-label="Assignee info">
                  <IconInfoCircle size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>

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
                <Text size="sm" c="dimmed">no data</Text>
              )
            ) : (
              <AssigneeSpaceMemberSelect
                spaceId={page.spaceId}
                value={fields.assigneeId}
                onChange={(value) => handleFieldChange({ ...fields, assigneeId: value })}
              />
            )}
          </Stack>
        )}

        {enabledFields.stakeholders && (
          <Stack gap={4}>
            <Group gap={6}>
              <Text size="sm" fw={600}>Stakeholders</Text>
              <Tooltip label="People involved in this document">
                <ActionIcon variant="subtle" size="sm" aria-label="Stakeholders info">
                  <IconInfoCircle size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>

            {readOnly ? (
              fields.stakeholderIds.length ? (
                <Stack gap="xs">
                  {fields.stakeholderIds.map((id) => (
                    <Group key={id} gap="xs" wrap="nowrap">
                      <CustomAvatar
                        avatarUrl={knownUsersById[id]?.avatarUrl}
                        size={18}
                        name={knownUsersById[id]?.label ?? id}
                      />
                      <Text size="sm">{knownUsersById[id]?.label ?? id}</Text>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">no data</Text>
              )
            ) : (
              <StakeholdersSpaceMemberMultiSelect
                spaceId={page.spaceId}
                value={fields.stakeholderIds}
                onChange={(value) => handleFieldChange({ ...fields, stakeholderIds: value })}
              />
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

export default DocumentFieldsPanel;
