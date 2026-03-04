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
import { useMutation } from "@tanstack/react-query";
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
import { AssigneeSpaceMemberSelect } from "@/features/page/components/document-fields/assignee-space-member-select.tsx";
import { StakeholdersSpaceMemberMultiSelect } from "@/features/page/components/document-fields/stakeholders-space-member-multiselect.tsx";
import { useSpaceMemberSelectOptions } from "@/features/page/components/document-fields/space-member-select-utils.ts";
import {
  useBatchUpdateDatabaseCellsMutation,
  useDatabaseRowContextQuery,
} from "@/features/database/queries/database-table-query";
import { updatePageData } from "@/features/page/queries/page-query";
import { DatabaseCellRenderer } from "@/features/database/components/database-cell-renderer.tsx";
import { useDatabasePropertiesQuery } from "@/features/database/queries/database-table-query";
import {
  IDatabaseProperty,
  IDatabaseSelectOption,
} from "@/features/database/types/database.types.ts";
import { DatabasePropertyType } from "@docmost/api-contract";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { Link } from "react-router-dom";
import { useGetRootSidebarPagesQuery } from "@/features/page/queries/page-query.ts";

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
  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;
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
  const pageQuery = useGetRootSidebarPagesQuery({
    spaceId: page.spaceId,
    includeNodeTypes: ["page", "database"],
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

  const getSelectSettings = (
    property: IDatabaseProperty,
  ): IDatabaseSelectOption[] => {
    if (
      !property.settings ||
      typeof property.settings !== "object" ||
      !("options" in property.settings)
    ) {
      return [];
    }

    const options = property.settings.options;
    return Array.isArray(options) ? options : [];
  };

  const getSelectOptionLabel = (
    property: IDatabaseProperty,
    value: string,
  ): string => {
    const option = getSelectSettings(property).find(
      (item) => item.value === value,
    );
    return option?.label ?? value;
  };

  const databaseUserIds = useMemo(() => {
    const ids: string[] = [];

    dbProperties.forEach((property) => {
      if (property.type !== "user") {
        return;
      }

      const propertyValue = dbFieldValues.get(property.id);
      if (typeof propertyValue === "string") {
        ids.push(propertyValue);
        return;
      }

      if (
        propertyValue &&
        typeof propertyValue === "object" &&
        "id" in propertyValue
      ) {
        const maybeId = (propertyValue as { id?: unknown }).id;
        if (typeof maybeId === "string") {
          ids.push(maybeId);
        }
      }
    });

    return ids;
  }, [dbFieldValues, dbProperties]);

  const { knownUsersById: knownDbUsersById } = useSpaceMemberSelectOptions(
    page.spaceId,
    databaseUserIds,
  );

  const pageOptions = useMemo(
    () =>
      (pageQuery.data?.pages ?? [])
        .flatMap((pageGroup) => pageGroup.items)
        .map((node) => ({
          value: node.id,
          label: node.title || t("untitled"),
          slugId: node.slugId,
          title: node.title || t("untitled"),
        })),
    [pageQuery.data?.pages, t],
  );

  const pageReferenceMetaById = useMemo(
    () =>
      new Map(
        pageOptions.map((option) => [
          option.value,
          {
            label: option.label,
            url: option.slugId
              ? buildPageUrl(page.space.slug, option.slugId, option.title)
              : null,
          },
        ]),
      ),
    [page.space.slug, pageOptions],
  );

  const [editingDbPropertyId, setEditingDbPropertyId] = useState<string | null>(
    null,
  );
  const [editingDbValue, setEditingDbValue] = useState<unknown>("");

  const buildCellPayloadValue = (
    property: IDatabaseProperty,
    value: unknown,
  ): unknown => {
    if (property.type === "checkbox") {
      return Boolean(value);
    }

    if (property.type === "user") {
      if (value && typeof value === "object" && "id" in value) {
        const userId = (value as { id?: unknown }).id;
        return typeof userId === "string" && userId.trim()
          ? { id: userId }
          : null;
      }

      if (typeof value === "string" && value.trim()) {
        return { id: value.trim() };
      }

      return null;
    }

    if (property.type === "page_reference") {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      return null;
    }

    if (typeof value === "string") {
      return value;
    }

    return value ?? "";
  };

  const renderReadOnlyDbValue = (property: IDatabaseProperty) => {
    const value = dbFieldValues.get(property.id);

    if (property.type === "page_reference") {
      const refId = typeof value === "string" ? value : "";
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
      const selected = getSelectSettings(property).find(
        (option) => option.value === (typeof value === "string" ? value : ""),
      );

      return selected ? (
        <Badge color={selected.color || "gray"} variant="light" my={8}>
          {selected.label}
        </Badge>
      ) : (
        <Text size="sm" c="dimmed" my={8}>
          {t("no data")}
        </Text>
      );
    }

    if (property.type === "user") {
      const userId =
        typeof value === "string"
          ? value
          : value &&
              typeof value === "object" &&
              "id" in value &&
              typeof (value as { id?: unknown }).id === "string"
            ? (value as { id: string }).id
            : "";

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
      return <Checkbox checked={Boolean(value)} disabled readOnly my={8} />;
    }

    if (typeof value === "string" && value) {
      return (
        <Text size="sm" my={8}>
          {value}
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
                      getSelectOptionLabel={getSelectOptionLabel}
                      onStartEdit={() => {
                        setEditingDbPropertyId(property.id);
                        setEditingDbValue(dbFieldValues.get(property.id));
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
