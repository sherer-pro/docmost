import React, { useEffect, useMemo, useState } from "react";
import {
  alpha,
  Badge,
  Checkbox,
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { updatePage } from "@/features/page/services/page-service.ts";
import {
  IPage,
  PageAiRole,
  PageCustomFields,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useAtomValue } from "jotai";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { resolvePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
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
import { sortDatabasePropertiesByPosition } from "@/features/database/utils/database-property-order.ts";
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
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import classes from "./document-fields-panel.module.css";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import {
  AI_ROLE_OPTIONS,
  DEFAULT_AI_ROLE,
} from "@/features/page/components/document-fields/ai-role-options.ts";

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
    color: "yellow",
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
    aiRole: customFields?.aiRole ?? DEFAULT_AI_ROLE,
  };
}

export function DocumentFieldsPanel({
  page,
  readOnly,
}: DocumentFieldsPanelProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const emit = useQueryEmit();
  const currentUser = useAtomValue(currentUserAtom);
  const documentFields = page.space?.settings?.documentFields;
  const userPageEditMode = resolvePageEditMode({
    pageId: page.id,
    preferences: currentUser?.user?.settings?.preferences,
  });
  const isEditable = !readOnly && userPageEditMode === PageEditMode.Edit;

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
      aiRole: !!documentFields?.aiRole,
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
    { pageId: page.id },
  );
  const { data: rowContext } = useDatabaseRowContextQuery(page.id);
  const updateDatabaseCellsMutation = useBatchUpdateDatabaseCellsMutation(
    rowContext?.database?.id,
  );
  const emitDatabaseInvalidation = () => {
    const databaseId = rowContext?.database?.id;
    if (!databaseId) {
      return;
    }

    emit({
      operation: "invalidate",
      spaceId: page.spaceId,
      entity: ["database", databaseId, "rows"],
    });
    emit({
      operation: "invalidate",
      spaceId: page.spaceId,
      entity: ["database", "row-context"],
    });
  };

  const { data: databaseProperties } = useDatabasePropertiesQuery(
    rowContext?.database?.id,
  );
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

    const mergedProperties = propertiesFromContext.map((contextProperty, contextIndex) => {
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
        position: contextProperty.position ?? contextIndex,
        settings: {},
        creatorId: null,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      };
    });

    return sortDatabasePropertiesByPosition(mergedProperties);
  }, [
    databaseProperties,
    page.workspaceId,
    rowContext?.database.id,
    rowContext?.properties,
  ]);

  const hasDbPageReferenceField = useMemo(
    () => dbProperties.some((property) => property.type === "page_reference"),
    [dbProperties],
  );
  const allPagesQuery = useQuery({
    queryKey: [
      ...PAGE_QUERY_KEYS.rootSidebar(page.spaceId, ["page", "database"]),
      "all-pages",
    ],
    queryFn: () =>
      getAllSidebarPages({
        spaceId: page.spaceId,
        includeNodeTypes: ["page", "database"],
      }),
    enabled: Boolean(page.spaceId && hasDbPageReferenceField),
  });

  const databaseUserIds = useMemo(() => {
    const ids: string[] = [];

    dbProperties.forEach((property) => {
      if (property.type !== "user") {
        return;
      }

      const propertyValue = dbFieldValues.get(property.id);
      if (typeof propertyValue === "string") {
        const normalizedUserId =
          normalizeDatabaseStringValue(propertyValue).trim();
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
    { pageId: page.id },
  );

  const allPageNodes = useMemo(
    () =>
      allPagesQuery.data?.pages.flatMap((queryPage) => queryPage.items) ?? [],
    [allPagesQuery.data?.pages],
  );
  const pageReferenceOptions = useMemo(
    () =>
      allPageNodes.map((node) => ({
        value: node.id,
        label: node.title || t("untitled"),
      })),
    [allPageNodes, t],
  );
  const pageReferenceUrlById = useMemo(
    () =>
      new Map(
        allPageNodes.map((node) => {
          const pageTitle = node.title || t("untitled");

          return [
            node.id,
            node.slugId
              ? buildPageUrl(page.space.slug, node.slugId, pageTitle)
              : null,
          ];
        }),
      ),
    [allPageNodes, page.space.slug, t],
  );

  const pageReferenceMetaById = useMemo(
    () =>
      new Map(
        pageReferenceOptions.map((option) => [
          option.value,
          {
            label: option.label,
            url: pageReferenceUrlById.get(option.value) ?? null,
          },
        ]),
      ),
    [pageReferenceOptions, pageReferenceUrlById],
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
      return (
        <Checkbox
          checked={normalizeDatabaseCheckboxValue(value)}
          disabled
          readOnly
          my={8}
        />
      );
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
      emit({
        operation: "updateOne",
        spaceId: updatedPage.spaceId,
        entity: ["pages"],
        id: updatedPage.id,
        payload: {
          title: updatedPage.title,
          slugId: updatedPage.slugId,
          parentPageId: updatedPage.parentPageId,
          icon: updatedPage.icon,
          customFields: updatedPage.customFields,
        },
      });
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
  const selectedAiRole = AI_ROLE_OPTIONS.find(
    (item) => item.value === fields.aiRole,
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

  const aiRoleInputStyles = useMemo(() => {
    if (!selectedAiRole) {
      return undefined;
    }

    const colorScale = theme.colors[selectedAiRole.palette];

    return {
      input: {
        backgroundColor: alpha(colorScale[1], 0.35),
        borderColor: colorScale[4],
      },
    };
  }, [selectedAiRole, theme.colors]);

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

  const renderAiRoleOption: SelectProps["renderOption"] = ({
    option,
  }) => {
    const selected = AI_ROLE_OPTIONS.find(
      (item) => item.value === option.value,
    );

    if (!selected) {
      return <Text size="sm">{option.label}</Text>;
    }

    return (
      <Tooltip
        label={t(selected.tooltip)}
        multiline
        w={300}
        withArrow
        events={{ hover: true, focus: true, touch: true }}
      >
        <Stack gap={2} py={2} style={{ minWidth: 0 }}>
          <Badge color={selected.color} variant="light">
            {t(selected.label)}
          </Badge>
          <Text size="xs" c="dimmed" lineClamp={2}>
            {t(selected.tooltip)}
          </Text>
        </Stack>
      </Tooltip>
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
        <AccessibleActionIcon
          label={t(ariaLabel)}
          tooltip={false}
          variant="subtle"
          size={32}
        >
          <IconInfoCircle size={14} />
        </AccessibleActionIcon>
      </Tooltip>
    </Group>
  );

  const renderMobileFieldLabel = (label: string, translate = true) => (
    <Text hiddenFrom="sm" className={classes.mobileFieldLabel}>
      {translate ? t(label) : label}
    </Text>
  );

  if (
    !enabledFields.status &&
    !enabledFields.assignee &&
    !enabledFields.stakeholders &&
    !enabledFields.aiRole &&
    !dbProperties.length
  ) {
    return null;
  }

  return (
    <div className={classes.fullWidthContainer}>
      <Group mx={0}>
        <Paper withBorder radius="md" my="md" mx={0}>
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
                    {renderMobileFieldLabel("Status")}
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

              {enabledFields.aiRole && (
                <Table.Tr>
                  <Table.Td visibleFrom="sm">
                    {renderFieldLabel(
                      "AI role",
                      "Shows the role AI played in creating or editing this document.",
                      "AI role info",
                    )}
                  </Table.Td>
                  <Table.Td>
                    {renderMobileFieldLabel("AI role")}
                    {isFieldsReadOnly ? (
                      selectedAiRole ? (
                        <Tooltip
                          label={t(selectedAiRole.tooltip)}
                          multiline
                          w={300}
                          withArrow
                          events={{ hover: true, focus: true, touch: true }}
                        >
                          <Badge
                            color={selectedAiRole.color}
                            variant="light"
                            my={8}
                            tabIndex={0}
                          >
                            {t(selectedAiRole.label)}
                          </Badge>
                        </Tooltip>
                      ) : null
                    ) : (
                      <Select
                        data={AI_ROLE_OPTIONS.map((item) => ({
                          value: item.value,
                          label: t(item.label),
                        }))}
                        value={fields.aiRole}
                        onChange={(value) => {
                          if (!value) {
                            return;
                          }

                          handleFieldChange({
                            ...fields,
                            aiRole: value as PageAiRole,
                          });
                        }}
                        placeholder={t("Select AI role")}
                        allowDeselect={false}
                        renderOption={renderAiRoleOption}
                        styles={aiRoleInputStyles}
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
                    {renderMobileFieldLabel("Assignee")}
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
                        pageId={page.id}
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
                    {renderMobileFieldLabel("Stakeholders")}
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
                        pageId={page.id}
                        spaceId={page.spaceId}
                        value={fields.stakeholderIds}
                        onChange={(value) =>
                          handleFieldChange({
                            ...fields,
                            stakeholderIds: value,
                          })
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
                    {renderMobileFieldLabel(property.name, false)}
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
                        pageOptions={pageReferenceOptions}
                        pageReferenceUrlById={pageReferenceUrlById}
                        isPageOptionsLoading={allPagesQuery.isLoading}
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

                          updateDatabaseCellsMutation.mutate(
                            {
                              pageId: page.id,
                              payload: {
                                cells: [
                                  {
                                    propertyId: property.id,
                                    value: shouldDelete
                                      ? null
                                      : normalizedValue,
                                    operation: shouldDelete
                                      ? "delete"
                                      : "upsert",
                                  },
                                ],
                              },
                            },
                            {
                              onSuccess: () => {
                                emitDatabaseInvalidation();
                              },
                            },
                          );

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
    </div>
  );
}

export default DocumentFieldsPanel;
