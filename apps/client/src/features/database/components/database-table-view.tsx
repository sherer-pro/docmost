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
import { Link } from 'react-router-dom';
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
  spaceSlug: string;
}

const DEFAULT_FILTER: IDatabaseFilterCondition = {
  propertyId: '',
  operator: 'contains',
  value: '',
};

function getRowTitle(row: IDatabaseRowWithCells): string {
  return row.page?.title || row.pageTitle || "untitled";
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
 * Табличное представление базы данных.
 *
 * Компонент реализует MVP-функции:
 * - sticky header и горизонтальный scroll;
 * - dynamic columns из properties;
 * - inline edit с сохранением через batch endpoint;
 * - add property / add row;
 * - visibility menu;
 * - filter (до 3 условий) и sort по одному полю.
 */
export function DatabaseTableView({
  databaseId,
  spaceSlug,
}: DatabaseTableViewProps) {
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const { data: rows = [] } = useDatabaseRowsQuery(databaseId);

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
    const key = `${row.pageId}:${property.id}`;
    setEditingCellKey(key);
    setEditingValue(getCellValue(row, property.id));
  };

  const saveEditing = async (row: IDatabaseRowWithCells, propertyId: string) => {
    if (!editingCellKey) {
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
            placeholder="Новая колонка"
            value={newPropertyName}
            onChange={(event) => setNewPropertyName(event.currentTarget.value)}
          />
          <Button
            leftSection={<IconPlus size={14} />}
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
            Property
          </Button>

          <Button
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => createRowMutation.mutate({})}
          >
            Row
          </Button>
        </Group>

        <Group>
          <Select
            placeholder="Sort"
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
                Columns
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

              {properties.length > 0 && <Menu.Divider />}

              {properties.map((property) => (
                <Menu.Item
                  key={`${property.id}-delete`}
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => deletePropertyMutation.mutate(property.id)}
                >
                  Delete {property.name}
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
              placeholder="Поле"
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
                { value: 'contains', label: 'contains' },
                { value: 'equals', label: 'equals' },
                { value: 'not_equals', label: 'not equals' },
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
              placeholder="Значение"
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
              <IconTrash size={18} />
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
          Filter
        </Button>
      </Stack>

      <ScrollArea>
        <Table stickyHeader withTableBorder withColumnBorders miw={900}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th miw={280}>Title</Table.Th>
              <Table.Th w={54}></Table.Th>
              {displayedProperties.map((property) => (
                <Table.Th key={property.id} miw={220}>
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm">{property.name}</Text>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() => deletePropertyMutation.mutate(property.id)}
                      aria-label={`Delete ${property.name}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {preparedRows.map((row) => (
              <Table.Tr key={row.id}>
                <Table.Td>
                  <Text component={Link} to={`/s/${spaceSlug}/p/${row.pageId}`}>
                    {getRowTitle(row)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => deleteRowMutation.mutate(row.pageId)}
                    aria-label="Delete row"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>

                {displayedProperties.map((property) => {
                  const key = `${row.pageId}:${property.id}`;
                  const isEditing = editingCellKey === key;
                  const value = getCellValue(row, property.id);

                  return (
                    <Table.Td
                      key={property.id}
                      onClick={() => startEditing(row, property)}
                    >
                      {isEditing ? (
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
                        value || '—'
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
