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
import { useTranslation } from "react-i18next";
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
  // Статусы храним в виде фиксированных enum-значений, а label оставляем
  // на английском как source key для стандартной локализации через t().
  { value: PageCustomFieldStatus.TODO, label: "TODO", color: "gray" },
  { value: PageCustomFieldStatus.IN_PROGRESS, label: "In progress", color: "blue" },
  { value: PageCustomFieldStatus.IN_REVIEW, label: "In review", color: "indigo" },
  { value: PageCustomFieldStatus.DONE, label: "Done", color: "green" },
  { value: PageCustomFieldStatus.REJECTED, label: "Rejected", color: "red" },
  { value: PageCustomFieldStatus.ARCHIVED, label: "Archived", color: "dark" },
];

function normalizeCustomFields(customFields?: PageCustomFields): Required<PageCustomFields> {
  // Нормализуем nullable-поля из API в предсказуемую форму для controlled-компонентов.
  return {
    status: customFields?.status ?? null,
    assigneeId: customFields?.assigneeId ?? null,
    stakeholderIds: customFields?.stakeholderIds ?? [],
  };
}

export function DocumentFieldsPanel({ page, readOnly }: DocumentFieldsPanelProps) {
  const { t } = useTranslation();
  const documentFields = page.space?.settings?.documentFields;

  const enabledFields = useMemo(
    () => ({
      // Отрисовываем только те поля, которые включены на уровне настроек пространства.
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
    // Дебаунс уменьшает количество запросов при быстром изменении полей.
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
              />
            )}
          </Stack>
        )}

        {enabledFields.assignee && (
          <Stack gap={4}>
            <Group gap={6}>
              <Text size="sm" fw={600}>{t("Assignee")}</Text>
              <Tooltip
                multiline
                w={300}
                label={t(
                  "The assignee is the space member responsible for keeping this document up to date and driving work to completion.",
                )}
              >
                <ActionIcon variant="subtle" size="sm" aria-label={t("Assignee info")}>
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
                <Text size="sm" c="dimmed">{t("no data")}</Text>
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
              <Text size="sm" fw={600}>{t("Stakeholders")}</Text>
              <Tooltip
                multiline
                w={300}
                label={t(
                  "Stakeholders are space members who are affected by this document, contribute context, or should be notified about important changes.",
                )}
              >
                <ActionIcon variant="subtle" size="sm" aria-label={t("Stakeholders info")}>
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
                <Text size="sm" c="dimmed">{t("no data")}</Text>
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
