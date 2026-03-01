import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconEye, IconEyeOff, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useSpaceQuery } from '@/features/space/queries/space-query.ts';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useBatchUpdateDatabaseCellsMutation,
  useCreateDatabasePropertyMutation,
  useCreateDatabaseRowMutation,
  useDeleteDatabasePropertyMutation,
  useDeleteDatabaseRowMutation,
  useDatabasePropertiesQuery,
  useDatabaseRowsQuery,
} from '@/features/database/queries/database-table-query';
import {
  IDatabaseFilterCondition,
  IDatabaseRowWithCells,
  IDatabaseSortState,
} from '@/features/database/types/database-table.types';
import { IDatabaseProperty } from '@/features/database/types/database.types';

interface DatabaseTableViewProps {
  databaseId: string;
  spaceId: string;
  spaceSlug: string;
  isEditable?: boolean;
}

const DEFAULT_FILTER: IDatabaseFilterCondition = {
  propertyId: '',
  operator: 'contains',
  value: '',
};

function getRowTitle(row: IDatabaseRowWithCells, untitledLabel: string): string {
  return row.page?.title || row.pageTitle || untitledLabel;
}

function getCellValue(row: IDatabaseRowWithCells, propertyId: string): string {
  const value = row.cells?.find((cell) => cell.propertyId === propertyId)?.value;

  if (value === null || typeof value === 'undefined') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}


interface RowFieldVisibility {
  status: boolean;
  assignee: boolean;
  stakeholders: boolean;
}

/**
 * Normalizes database row custom fields based on enabled document fields in the space.
 */
function getVisibleRowCustomFields(
  row: IDatabaseRowWithCells,
  fieldVisibility: RowFieldVisibility,
) {
  const customFields = row.page?.customFields;

  return {
    status: fieldVisibility.status ? customFields?.status ?? null : null,
    assigneeId: fieldVisibility.assignee ? customFields?.assigneeId ?? null : null,
    stakeholderIds: fieldVisibility.stakeholders
      ? customFields?.stakeholderIds ?? []
      : [],
  };
}

function matchCondition(value: string, condition: IDatabaseFilterCondition): boolean {
  const normalizedValue = value.toLowerCase();
  const normalizedFilter = condition.value.toLowerCase();

  if (!condition.value) {
    return true;
  }

  if (condition.operator === 'equals') {
    return normalizedValue === normalizedFilter;
  }

  if (condition.operator === 'not_equals') {
    return normalizedValue !== normalizedFilter;
  }

  return normalizedValue.includes(normalizedFilter);
}

/**
 * Database table view.
 *
 * The component provides MVP functionality:
 * - sticky header and horizontal scrolling;
 * - dynamic columns from properties;
 * - inline editing with batch endpoint persistence;
 * - add property / add row;
 * - visibility menu;
 * - filtering (up to 3 conditions) and single-field sorting.
 */
export function DatabaseTableView({
  databaseId,
  spaceId,
  spaceSlug,
  isEditable = true,
}: DatabaseTableViewProps) {
  const { t } = useTranslation();
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const { data: rows = [] } = useDatabaseRowsQuery(databaseId);
  const { data: space } = useSpaceQuery(spaceId);

  const createPropertyMutation = useCreateDatabasePropertyMutation(databaseId);
  const createRowMutation = useCreateDatabaseRowMutation(databaseId);
  const updateCellsMutation = useBatchUpdateDatabaseCellsMutation(databaseId);
  const deletePropertyMutation = useDeleteDatabasePropertyMutation(databaseId);
  const deleteRowMutation = useDeleteDatabaseRowMutation(databaseId);

  const [newPropertyName, setNewPropertyName] = useState('');
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<IDatabaseFilterCondition[]>([DEFAULT_FILTER]);
  const [sortState, setSortState] = useState<IDatabaseSortState | null>(null);

  const displayedProperties = useMemo(
    () =>
      properties.filter((property) => {
        const explicitValue = visibleColumns[property.id];
        return typeof explicitValue === 'boolean' ? explicitValue : true;
      }),
    [properties, visibleColumns],
  );

  const filteredRows = useMemo(() => {
    const activeFilters = filters.filter(
      (condition) => condition.propertyId && condition.value,
    );

    return rows.filter((row) => {
      return activeFilters.every((condition) => {
        const value = getCellValue(row, condition.propertyId);
        return matchCondition(value, condition);
      });
    });
  }, [rows, filters]);

  const fieldVisibility = useMemo(
    () => ({
      status: !!space?.settings?.documentFields?.status,
      assignee: !!space?.settings?.documentFields?.assignee,
      stakeholders: !!space?.settings?.documentFields?.stakeholders,
    }),
    [space?.settings?.documentFields],
  );

  const preparedRows = useMemo(() => {
    if (!sortState) {
      return filteredRows;
    }

    return [...filteredRows].sort((left, right) => {
      const leftValue = getCellValue(left, sortState.propertyId);
      const rightValue = getCellValue(right, sortState.propertyId);
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: 'base',
      });

      return sortState.direction === 'asc' ? result : -result;
    });
  }, [filteredRows, sortState]);

  const startEditing = (row: IDatabaseRowWithCells, property: IDatabaseProperty) => {
    if (!isEditable) {
      return;
    }

    const key = `${row.pageId}:${property.id}`;
    setEditingCellKey(key);
    setEditingValue(getCellValue(row, property.id));
  };

  const saveEditing = async (row: IDatabaseRowWithCells, propertyId: string) => {
    if (!editingCellKey || !isEditable) {
      return;
    }

    await updateCellsMutation.mutateAsync({
      pageId: row.pageId,
      payload: {
        cells: [
          {
            propertyId,
            value: editingValue,
            operation: 'upsert',
          },
        ],
      },
    });

    setEditingCellKey(null);
    setEditingValue('');
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="md" align="flex-end">
        <Group>
          <TextInput
            placeholder={t('New column')}
            value={newPropertyName}
            onChange={(event) => setNewPropertyName(event.currentTarget.value)}
            disabled={!isEditable}
          />
          <Button
            leftSection={<IconPlus size={14} />}
            disabled={!isEditable}
            onClick={() => {
              if (!newPropertyName.trim()) {
                return;
              }

              createPropertyMutation.mutate({
                name: newPropertyName.trim(),
                type: 'text',
              });
              setNewPropertyName('');
            }}
          >
            {t('Property')}
          </Button>

          <Button
            variant="light"
            leftSection={<IconPlus size={14} />}
            disabled={!isEditable}
            onClick={() => createRowMutation.mutate({})}
          >
            {t('Row')}
          </Button>
        </Group>

        <Group>
          <Select
            placeholder={t('Sort')}
            data={properties.map((property) => ({
              value: property.id,
              label: property.name,
            }))}
            value={sortState?.propertyId || null}
            onChange={(value) => {
              if (!value) {
                setSortState(null);
                return;
              }

              setSortState({
                propertyId: value,
                direction: sortState?.direction === 'asc' ? 'desc' : 'asc',
              });
            }}
            clearable
          />

          <Menu shadow="md" width={220}>
            <Menu.Target>
              <Button variant="default" disabled={properties.length === 0}>
                {t('Columns')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {properties.map((property) => {
                const isVisible =
                  typeof visibleColumns[property.id] === 'boolean'
                    ? visibleColumns[property.id]
                    : true;

                return (
                  <Menu.Item
                    key={property.id}
                    leftSection={
                      <ActionIcon variant="subtle" size="sm">
                        {isVisible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                      </ActionIcon>
                    }
                    onClick={() =>
                      setVisibleColumns((prev) => ({
                        ...prev,
                        [property.id]: !isVisible,
                      }))
                    }
                  >
                    {property.name}
                  </Menu.Item>
                );
              })}

              {isEditable && properties.length > 0 && <Menu.Divider />}

              {isEditable &&
                properties.map((property) => (
                  <Menu.Item
                    key={`${property.id}-delete`}
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => deletePropertyMutation.mutate(property.id)}
                  >
                    {t('Delete property with name', { name: property.name })}
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Stack mb="md" gap="xs">
        {filters.map((condition, index) => (
          <Group key={`filter-${index}`} align="end" wrap="nowrap">
            <Select
              placeholder={t('Field')}
              data={properties.map((property) => ({
                value: property.id,
                label: property.name,
              }))}
              value={condition.propertyId}
              onChange={(value) => {
                setFilters((prev) =>
                  prev.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, propertyId: value || '' } : item,
                  ),
                );
              }}
            />

            <Select
              w={140}
              data={[
                { value: 'contains', label: t('contains') },
                { value: 'equals', label: t('equals') },
                { value: 'not_equals', label: t('not equals') },
              ]}
              value={condition.operator}
              onChange={(value) => {
                if (!value) {
                  return;
                }

                setFilters((prev) =>
                  prev.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          operator: value as IDatabaseFilterCondition['operator'],
                        }
                      : item,
                  ),
                );
              }}
            />

            <TextInput
              placeholder={t('Value')}
              value={condition.value}
              onChange={(event) => {
                setFilters((prev) =>
                  prev.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, value: event.currentTarget.value }
                      : item,
                  ),
                );
              }}
            />

            <Button
              variant="subtle"
              color="red"
              disabled={filters.length === 1}
              onClick={() =>
                setFilters((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
              }
            >
              {t('Remove')}
            </Button>
          </Group>
        ))}

        <Button
          w="fit-content"
          variant="subtle"
          leftSection={<IconPlus size={14} />}
          disabled={filters.length >= 3}
          onClick={() => setFilters((prev) => [...prev, { ...DEFAULT_FILTER }])}
        >
          {t('Filter')}
        </Button>
      </Stack>

      <ScrollArea>
        <Table stickyHeader withTableBorder withColumnBorders miw={900}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th miw={280}>{t('Title')}</Table.Th>
              {displayedProperties.map((property) => (
                <Table.Th key={property.id} miw={220}>
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm">{property.name}</Text>
                    {isEditable && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() => deletePropertyMutation.mutate(property.id)}
                        aria-label={t('Delete property with name', { name: property.name })}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {preparedRows.map((row) => (
              <Table.Tr key={row.id}>
                <Table.Td>
                  <Group justify="space-between" >
                  <div>
                    <Text component={Link} to={`/s/${spaceSlug}/p/${row.pageId}`}>
                      {getRowTitle(row, t('untitled'))}
                    </Text>

                    {/**
                     * Show row document fields only when the field is enabled
                     * in space settings. Values are read strictly from row.page.customFields.
                     */}
                    {(() => {
                      const customFields = getVisibleRowCustomFields(row, fieldVisibility);

                      if (
                        !customFields.status &&
                        !customFields.assigneeId &&
                        customFields.stakeholderIds.length === 0
                      ) {
                        return null;
                      }

                      return (
                        <Text size="xs" c="dimmed">
                          {[
                            customFields.status
                              ? t('Status value', { value: customFields.status })
                              : null,
                            customFields.assigneeId
                              ? t('Assignee value', { value: customFields.assigneeId })
                              : null,
                            customFields.stakeholderIds.length > 0
                              ? t('Stakeholders count', {
                                  count: customFields.stakeholderIds.length,
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      );
                    })()}
                  </div>

                  {isEditable && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => deleteRowMutation.mutate(row.pageId)}
                      aria-label={t('Delete row')}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                  </Group>
                </Table.Td>

                {displayedProperties.map((property) => {
                  const key = `${row.pageId}:${property.id}`;
                  const isEditing = editingCellKey === key;
                  const value = getCellValue(row, property.id);

                  return (
                    <Table.Td
                      key={property.id}
                      onClick={() => startEditing(row, property)}
                      style={{ cursor: isEditable ? "text" : "default" }}
                    >
                      {isEditing && isEditable ? (
                        <TextInput
                          autoFocus
                          value={editingValue}
                          onChange={(event) =>
                            setEditingValue(event.currentTarget.value)
                          }
                          onBlur={() => saveEditing(row, property.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              saveEditing(row, property.id);
                            }
                          }}
                        />
                      ) : (
                        value || t('Empty value')
                      )}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}
