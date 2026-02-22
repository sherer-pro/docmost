import React, { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Group,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useDebouncedCallback } from "@mantine/hooks";
import { useMutation } from "@tanstack/react-query";
import { updatePage } from "@/features/page/services/page-service.ts";
import {
  IPage,
  PageCustomFields,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import { queryClient } from "@/main.tsx";
import { useSpaceMembersQuery } from "@/features/space/queries/space-query.ts";
import { ISpaceMember } from "@/features/space/types/space.types.ts";

interface DocumentFieldsPanelProps {
  page: IPage;
  readOnly: boolean;
}

const STATUS_OPTIONS: { value: PageCustomFieldStatus; label: string; color: string }[] = [
  { value: "not_started", label: "Not started", color: "gray" },
  { value: "in_progress", label: "In progress", color: "blue" },
  { value: "done", label: "Done", color: "green" },
];

/**
 * Нормализует значения кастомных полей документа, чтобы UI всегда работал со стабильной формой данных.
 */
function normalizeCustomFields(customFields?: PageCustomFields): Required<PageCustomFields> {
  return {
    status: customFields?.status ?? null,
    assigneeId: customFields?.assigneeId ?? null,
    stakeholderIds: customFields?.stakeholderIds ?? [],
  };
}

/**
 * Панель кастомных полей документа:
 * - рендерит только поля, включенные в настройках Space;
 * - показывает read-only представление с fallback "no data";
 * - в edit-режиме сохраняет изменения через debounced update API.
 */
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

  const { data: members } = useSpaceMembersQuery(page.spaceId, { limit: 100 });

  const userOptions = useMemo(() => {
    return (members?.items ?? [])
      .filter((member: ISpaceMember) => member.type === "user")
      .map((member: ISpaceMember) => ({
        value: member.id,
        label: member.name,
      }));
  }, [members]);

  const [fields, setFields] = useState<Required<PageCustomFields>>(
    normalizeCustomFields(page.customFields),
  );

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
   * Обновляет локальный state поля и отправляет отложенное сохранение на backend.
   */
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
  const assigneeLabel = userOptions.find((item) => item.value === fields.assigneeId)?.label;
  const stakeholderLabels = fields.stakeholderIds
    .map((id) => userOptions.find((item) => item.value === id)?.label)
    .filter(Boolean) as string[];

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
              assigneeLabel ? <Text size="sm">{assigneeLabel}</Text> : <Text size="sm" c="dimmed">no data</Text>
            ) : (
              <Select
                data={userOptions}
                value={fields.assigneeId}
                onChange={(value) => handleFieldChange({ ...fields, assigneeId: value || null })}
                placeholder="Select assignee"
                searchable
                clearable
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
              stakeholderLabels.length ? (
                <Group gap="xs">
                  {stakeholderLabels.map((name) => (
                    <Badge key={name} variant="light" color="gray">
                      {name}
                    </Badge>
                  ))}
                </Group>
              ) : (
                <Text size="sm" c="dimmed">no data</Text>
              )
            ) : (
              <MultiSelect
                data={userOptions}
                value={fields.stakeholderIds}
                onChange={(value) => handleFieldChange({ ...fields, stakeholderIds: value })}
                placeholder="Select stakeholders"
                searchable
                clearable
              />
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

export default DocumentFieldsPanel;
