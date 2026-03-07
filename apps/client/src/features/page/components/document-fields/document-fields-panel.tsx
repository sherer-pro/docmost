import React, { useEffect, useMemo, useState } from "react";
import {
  alpha,
  ActionIcon,
  Badge,
  Checkbox,
  Group,
  Paper,
  Select,
  SelectProps,
  Table,
  Text,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useDebouncedCallback } from "@mantine/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { updatePage } from "@/features/page/services/page-service.ts";
import {
  IPage,
  PageCustomFields,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useAtomValue } from "jotai";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { normalizePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
import { AssigneeSpaceMemberSelect } from "@/features/page/components/document-fields/assignee-space-member-select.tsx";
import { StakeholdersSpaceMemberMultiSelect } from "@/features/page/components/document-fields/stakeholders-space-member-multiselect.tsx";
import { useSpaceMemberSelectOptions } from "@/features/page/components/document-fields/space-member-select-utils.tsx";
import {
  useBatchUpdateDatabaseCellsMutation,
  useDatabaseRowContextQuery,
} from "@/features/database/queries/database-table-query";
import { updatePageData } from "@/features/page/queries/page-query";
import { DatabaseCellRenderer } from "@/features/database/components/database-cell-renderer.tsx";
import { useDatabasePropertiesQuery } from "@/features/database/queries/database-table-query";
import { IDatabaseProperty } from "@/features/database/types/database.types.ts";
import {
  buildDatabaseCellPayloadValue,
  extractCurrentDatabaseCellValue,
  getDatabaseSelectOption,
  normalizeDatabaseCheckboxValue,
  normalizeDatabasePageReferenceValue,
  normalizeDatabaseSelectValue,
  normalizeDatabaseStringValue,
  normalizeDatabaseUserId,
} from "@/features/database/utils/database-cell-value.ts";
import { DatabasePropertyType } from "@docmost/api-contract";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { Link } from "react-router-dom";
import { PAGE_QUERY_KEYS } from "@/features/page/queries/query-keys.ts";
import { getAllSidebarPages } from "@/features/page/services/page-service.ts";

interface DocumentFieldsPanelProps {
  page: IPage;
  readOnly: boolean;
}

const STATUS_OPTIONS: {
  value: PageCustomFieldStatus;
  label: string;
  color: string;
}[] = [
  { value: PageCustomFieldStatus.TODO, label: "TODO", color: "gray" },
  {
    value: PageCustomFieldStatus.IN_PROGRESS,
    label: "In progress",
    color: "blue",
  },
  {
    value: PageCustomFieldStatus.IN_REVIEW,
    label: "In review",
    color: "indigo",
  },
  { value: PageCustomFieldStatus.DONE, label: "Done", color: "green" },
  { value: PageCustomFieldStatus.REJECTED, label: "Rejected", color: "red" },
  { value: PageCustomFieldStatus.ARCHIVED, label: "Archived", color: "dark" },
];

/**
 * Normalizes page custom fields into a fully populated structure,
 * so all controls remain controlled in read/edit modes and do not break on null/undefined.
 */
function normalizeCustomFields(
  customFields?: PageCustomFields,
): Required<PageCustomFields> {
  return {
    status: customFields?.status ?? null,
    assigneeId: customFields?.assigneeId ?? null,
    stakeholderIds: customFields?.stakeholderIds ?? [],
  };
}

export function DocumentFieldsPanel({
  page,
  readOnly,
}: DocumentFieldsPanelProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const currentUser = useAtomValue(currentUserAtom);
  const documentFields = page.space?.settings?.documentFields;
  const userPageEditMode = normalizePageEditMode(
    currentUser?.user?.settings?.preferences?.pageEditMode,
  );
  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

  const isDatabasePage = Boolean(page.databaseId);

  /**
   * In view mode, document fields must be rendered as read-only
   * so they can be edited only after switching to edit mode.
   */
  const isFieldsReadOnly = !isEditable;

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
    () => [
      ...(fields.assigneeId ? [fields.assigneeId] : []),
      ...fields.stakeholderIds,
    ],
    [fields.assigneeId, fields.stakeholderIds],
  );

  const { knownUsersById } = useSpaceMemberSelectOptions(
    page.spaceId,
    selectedMemberIds,
  );
  const { data: rowContext } = useDatabaseRowContextQuery(page.id);
  const updateDatabaseCellsMutation = useBatchUpdateDatabaseCellsMutation(
    rowContext?.database?.id,
  );

  const { data: databaseProperties } = useDatabasePropertiesQuery(
    rowContext?.database?.id,
  );
  const allPagesQuery = useQuery({
    queryKey: [...PAGE_QUERY_KEYS.rootSidebar(page.spaceId, ["page", "database"]), "all-pages"],
    queryFn: () =>
      getAllSidebarPages({
        spaceId: page.spaceId,
        includeNodeTypes: ["page", "database"],
      }),
    enabled: !!page.spaceId,
  });

  const rowCellMap = useMemo(() => {
    const map = new Map<string, unknown>();
    rowContext?.cells?.forEach((cell) => {
      map.set(cell.propertyId, cell.value);
    });
    return map;
  }, [rowContext?.cells]);

  const [dbFieldValues, setDbFieldValues] = useState<Map<string, unknown>>(
    new Map(),
  );

  useEffect(() => {
    setDbFieldValues(rowCellMap);
  }, [rowCellMap]);

  const dbProperties = useMemo<IDatabaseProperty[]>(() => {
    const propertiesFromContext = rowContext?.properties ?? [];

    if (!propertiesFromContext.length) {
      return databaseProperties ?? [];
    }

    const propertyById = new Map(
      (databaseProperties ?? []).map((property) => [property.id, property]),
    );

    return propertiesFromContext.map((contextProperty) => {
      const knownProperty = propertyById.get(contextProperty.id);
      if (knownProperty) {
        return knownProperty;
      }

      return {
        id: contextProperty.id,
        databaseId: rowContext?.database.id ?? "",
        workspaceId: page.workspaceId,
        name: contextProperty.name,
        type: contextProperty.type as DatabasePropertyType,
        position: 0,
        settings: {},
        creatorId: null,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      };
    });
  }, [
    databaseProperties,
    page.workspaceId,
    rowContext?.database.id,
    rowContext?.properties,
  ]);

  const databaseUserIds = useMemo(() => {
    const ids: string[] = [];

    dbProperties.forEach((property) => {
      if (property.type !== "user") {
        return;
      }

      const propertyValue = dbFieldValues.get(property.id);
      if (typeof propertyValue === "string") {
        const normalizedUserId = normalizeDatabaseStringValue(propertyValue).trim();
        if (normalizedUserId) {
          ids.push(normalizedUserId);
        }
        return;
      }

      if (
        propertyValue &&
        typeof propertyValue === "object" &&
        "id" in propertyValue
      ) {
        const maybeId = (propertyValue as { id?: unknown }).id;
        if (typeof maybeId === "string") {
          const normalizedUserId = normalizeDatabaseStringValue(maybeId).trim();
          if (normalizedUserId) {
            ids.push(normalizedUserId);
          }
        }
      }
    });

    return ids;
  }, [dbFieldValues, dbProperties]);

  const { knownUsersById: knownDbUsersById } = useSpaceMemberSelectOptions(
    page.spaceId,
    databaseUserIds,
  );

  const allPageNodes = useMemo(
    () => allPagesQuery.data?.pages.flatMap((queryPage) => queryPage.items) ?? [],
    [allPagesQuery.data?.pages],
  );

  const pageReferenceMetaById = useMemo(
    () =>
      new Map(
        allPageNodes.map((node) => {
          const pageTitle = node.title || t("untitled");

          return [
            node.id,
            {
              label: pageTitle,
              url: node.slugId
                ? buildPageUrl(page.space.slug, node.slugId, pageTitle)
                : null,
            },
          ];
        }),
      ),
    [allPageNodes, page.space.slug, t],
  );

  const [editingDbPropertyId, setEditingDbPropertyId] = useState<string | null>(
    null,
  );
  const [editingDbValue, setEditingDbValue] = useState<unknown>("");

  const buildCellPayloadValue = (
    property: IDatabaseProperty,
    value: unknown,
  ): unknown => {
    if (property.type === "page_reference") {
      const pageId = normalizeDatabasePageReferenceValue(value).trim();
      return pageId || null;
    }

    if (property.type === "select") {
      const selectValue = normalizeDatabaseSelectValue(value);
      return selectValue || null;
    }

    return buildDatabaseCellPayloadValue(property, value);
  };

  const renderReadOnlyDbValue = (property: IDatabaseProperty) => {
    const value = dbFieldValues.get(property.id);

    if (property.type === "page_reference") {
      const refId = normalizeDatabasePageReferenceValue(value);
      if (!refId) {
        return (
          <Text size="sm" c="dimmed" my={8}>
            {t("no data")}
          </Text>
        );
      }

      const target = pageReferenceMetaById.get(refId);
      if (target?.url) {
        return (
          <Text size="sm" component={Link} to={target.url} my={8}>
            {target.label}
          </Text>
        );
      }

      return (
        <Text size="sm" my={8}>
          {target?.label ?? refId}
        </Text>
      );
    }

    if (property.type === "select") {
      const selectValue = normalizeDatabaseSelectValue(value);
      if (!selectValue) {
        return (
          <Text size="sm" c="dimmed" my={8}>
            {t("no data")}
          </Text>
        );
      }

      const selectedOption = getDatabaseSelectOption(property, selectValue);

      return (
        <Badge color={selectedOption?.color || "gray"} variant="light" my={8}>
          {selectedOption?.label || selectValue}
        </Badge>
      );
    }

    if (property.type === "user") {
      const userId = normalizeDatabaseUserId(value) ?? "";

      if (!userId) {
        return (
          <Text size="sm" c="dimmed" my={8}>
            {t("no data")}
          </Text>
        );
      }

      const user = knownDbUsersById[userId];

      return (
        <Group gap="xs" wrap="nowrap" my={7.5}>
          <CustomAvatar
            avatarUrl={user?.avatarUrl}
            size={18}
            name={user?.label ?? userId}
          />
          <Text size="sm">{user?.label ?? userId}</Text>
        </Group>
      );
    }

    if (property.type === "checkbox") {
      return <Checkbox checked={normalizeDatabaseCheckboxValue(value)} disabled readOnly my={8} />;
    }

    const textValue = normalizeDatabaseStringValue(value);

    if (textValue) {
      return (
        <Text
          size="sm"
          my={8}
          ff={property.type === "code" ? "monospace" : undefined}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {textValue}
        </Text>
      );
    }

    return (
      <Text size="sm" c="dimmed" my={8}>
        {t("no data")}
      </Text>
    );
  };

  useEffect(() => {
    setFields(normalizeCustomFields(page.customFields));
  }, [page.customFields, page.id]);

  const { mutate } = useMutation({
    mutationFn: (nextFields: Required<PageCustomFields>) =>
      updatePage({ pageId: page.id, customFields: nextFields }),
    onSuccess: (updatedPage) => {
      updatePageData(updatedPage);
    },
  });

  const debouncedSave = useDebouncedCallback(
    (nextFields: Required<PageCustomFields>) => {
      mutate(nextFields);
    },
    600,
  );

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

  const selectedStatus = STATUS_OPTIONS.find(
    (item) => item.value === fields.status,
  );

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
  const renderFieldLabel = (
    label: string,
    tooltip: string,
    ariaLabel: string,
  ) => (
    <Group gap={6} wrap="nowrap">
      <Text size="sm" fw={600}>
        {t(label)}
      </Text>
      <Tooltip multiline w={300} label={t(tooltip)}>
        <ActionIcon variant="subtle" size="sm" aria-label={t(ariaLabel)}>
          <IconInfoCircle size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  if (
    !enabledFields.status &&
    !enabledFields.assignee &&
    !enabledFields.stakeholders &&
    !dbProperties.length
  ) {
    return null;
  }

  return (
    <Group mx={isDatabasePage ? 0 : { base: 0, sm: "md" }}>
      <Paper
        withBorder
        radius="md"
        my="md"
        mx={isDatabasePage ? 0 : { base: 0, sm: "xl" }}
      >
        <Table
          withColumnBorders
          verticalSpacing="xs"
          horizontalSpacing="sm"
          layout="fixed"
        >
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
                  {isFieldsReadOnly ? (
                    selectedStatus ? (
                      <Badge
                        color={selectedStatus.color}
                        variant="light"
                        my={8}
                      >
                        {t(selectedStatus.label)}
                      </Badge>
                    ) : (
                      <Text size="sm" c="dimmed" my={8}>
                        {t("no data")}
                      </Text>
                    )
                  ) : (
                    <Select
                      data={STATUS_OPTIONS.map((item) => ({
                        value: item.value,
                        label: t(item.label),
                      }))}
                      value={fields.status}
                      onChange={(value) =>
                        handleFieldChange({
                          ...fields,
                          status: (value as PageCustomFieldStatus) || null,
                        })
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
                  {isFieldsReadOnly ? (
                    fields.assigneeId ? (
                      <Group gap="xs" wrap="nowrap" my={7.5}>
                        <CustomAvatar
                          avatarUrl={
                            knownUsersById[fields.assigneeId]?.avatarUrl
                          }
                          size={18}
                          name={
                            knownUsersById[fields.assigneeId]?.label ??
                            fields.assigneeId
                          }
                        />
                        <Text size="sm">
                          {knownUsersById[fields.assigneeId]?.label ??
                            fields.assigneeId}
                        </Text>
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed" my={7.5}>
                        {t("no data")}
                      </Text>
                    )
                  ) : (
                    <AssigneeSpaceMemberSelect
                      spaceId={page.spaceId}
                      value={fields.assigneeId}
                      onChange={(value) =>
                        handleFieldChange({ ...fields, assigneeId: value })
                      }
                      onBlur={() => debouncedSave.flush()}
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
                  {isFieldsReadOnly ? (
                    fields.stakeholderIds.length ? (
                      <Group gap="xs" my={8} flex="wrap">
                        {fields.stakeholderIds.map((id) => (
                          <Group key={id} gap="xs" wrap="nowrap">
                            <CustomAvatar
                              avatarUrl={knownUsersById[id]?.avatarUrl}
                              size={18}
                              name={knownUsersById[id]?.label ?? id}
                            />
                            <Text size="sm">
                              {knownUsersById[id]?.label ?? id}
                            </Text>
                          </Group>
                        ))}
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed" my={8}>
                        {t("no data")}
                      </Text>
                    )
                  ) : (
                    <StakeholdersSpaceMemberMultiSelect
                      spaceId={page.spaceId}
                      value={fields.stakeholderIds}
                      onChange={(value) =>
                        handleFieldChange({ ...fields, stakeholderIds: value })
                      }
                      onBlur={() => debouncedSave.flush()}
                    />
                  )}
                </Table.Td>
              </Table.Tr>
            )}

            {dbProperties.map((property) => (
              <Table.Tr key={`db-field-${property.id}`}>
                <Table.Td visibleFrom="sm">
                  <Text size="sm" fw={600}>
                    {property.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {isFieldsReadOnly ? (
                    renderReadOnlyDbValue(property)
                  ) : (
                    <DatabaseCellRenderer
                      property={property}
                      value={dbFieldValues.get(property.id)}
                      isEditable={isEditable}
                      isEditing={editingDbPropertyId === property.id}
                      editingValue={editingDbValue}
                      spaceId={page.spaceId}
                      spaceSlug={page.space.slug}
                      onStartEdit={() => {
                        setEditingDbPropertyId(property.id);
                        setEditingDbValue(
                          extractCurrentDatabaseCellValue(
                            dbFieldValues.get(property.id),
                          ),
                        );
                      }}
                      onChange={setEditingDbValue}
                      onSave={(nextValue) => {
                        const sourceValue =
                          typeof nextValue === "undefined"
                            ? editingDbValue
                            : nextValue;
                        const normalizedValue = buildCellPayloadValue(
                          property,
                          sourceValue,
                        );
                        const shouldDelete =
                          property.type !== "checkbox" &&
                          (normalizedValue === null ||
                            normalizedValue === "" ||
                            (typeof normalizedValue === "object" &&
                              normalizedValue !== null &&
                              "id" in normalizedValue &&
                              !(normalizedValue as { id?: string }).id));

                        setDbFieldValues((prev) => {
                          const map = new Map(prev);
                          map.set(
                            property.id,
                            shouldDelete ? null : normalizedValue,
                          );
                          return map;
                        });

                        updateDatabaseCellsMutation.mutate({
                          pageId: page.id,
                          payload: {
                            cells: [
                              {
                                propertyId: property.id,
                                value: shouldDelete ? null : normalizedValue,
                                operation: shouldDelete ? "delete" : "upsert",
                              },
                            ],
                          },
                        });

                        setEditingDbPropertyId(null);
                        setEditingDbValue("");
                      }}
                    />
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Group>
  );
}

export default DocumentFieldsPanel;

