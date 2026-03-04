import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Select,
  SelectProps,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconMessageCircle,
  IconPlus,
  IconSquareCheck,
  IconSettings,
  IconSwitchHorizontal,
  IconTrash,
  IconUser,
  IconAlignJustified,
  IconCode,
  IconList,
  type TablerIcon,
  IconFileDescription,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { DATABASE_PROPERTY_TYPES, DatabasePropertyType } from '@docmost/api-contract';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { useAtomValue } from 'jotai/react';
import {
  useBatchUpdateDatabaseCellsMutation,
  useCreateDatabasePropertyMutation,
  useCreateDatabaseRowMutation,
  useDeleteDatabasePropertyMutation,
  useDeleteDatabaseRowMutation,
  useDatabasePropertiesQuery,
  useUpdateDatabasePropertyMutation,
  useDatabaseRowsQuery,
} from '@/features/database/queries/database-table-query';
import {
  IDatabaseFilterCondition,
  IDatabaseRowWithCells,
  IDatabaseSortState,
} from '@/features/database/types/database-table.types';
import {
  IDatabaseProperty,
  IDatabaseSelectOption,
  IDatabaseSelectPropertySettings,
} from '@/features/database/types/database.types';
import { SelectPropertySettingsModal } from '@/features/database/components/select-property-settings-modal';
import {
  defaultDatabaseTableExportState,
  databaseTableExportStateAtom,
} from '@/features/database/atoms/database-table-export-atom';
import {
  getCellValue,
  getRowTitle,
  matchCondition,
} from '@/features/database/utils/database-markdown';
import { DATABASE_PROPERTY_TYPE_LABEL_KEYS } from '@/features/database/utils/database-property-type-labels';
import { DatabaseCellRenderer } from '@/features/database/components/database-cell-renderer.tsx';
import { treeDataAtom } from '@/features/page/tree/atoms/tree-data-atom.ts';
import { SpaceTreeNode } from '@/features/page/tree/types.ts';
import { treeApiAtom } from '@/features/page/tree/atoms/tree-api-atom.ts';
import { useQueryEmit } from '@/features/websocket/use-query-emit.ts';
import {
  appendNodeChildren,
  insertDatabaseRowNode,
  setTreeNodeHasChildren,
} from '@/features/page/tree/utils/utils.ts';
import { queryClient } from '@/main.tsx';
import { getPageById } from '@/features/page/services/page-service.ts';
import { PAGE_QUERY_KEYS } from '@/features/page/queries/query-keys.ts';
import { fetchAllAncestorChildren } from '@/features/page/queries/page-query.ts';

interface DatabaseTableViewProps {
  databaseId: string;
  spaceId: string;
  spaceSlug: string;
  isEditable?: boolean;
}

interface SelectPropertyCreationDraft {
  name: string;
  initialSettings: IDatabaseSelectPropertySettings;
}

const DEFAULT_FILTER: IDatabaseFilterCondition = defaultDatabaseTableExportState.filters[0];

const DATABASE_PROPERTY_TYPE_ICONS: Record<DatabasePropertyType, TablerIcon> = {
  checkbox: IconSquareCheck,
  user: IconUser,
  multiline_text: IconAlignJustified,
  code: IconCode,
  select: IconList,
  page_reference: IconFileDescription,
};

const getPropertyTypeIcon = (propertyType: DatabasePropertyType): TablerIcon => {
  return DATABASE_PROPERTY_TYPE_ICONS[propertyType] ?? IconAlignJustified;
};

const renderPropertyTypeIcon = (propertyType: DatabasePropertyType, size: number) => {
  const Icon = getPropertyTypeIcon(propertyType);
  return <Icon size={size} />;
};

const renderPropertyTypeOption: SelectProps['renderOption'] = ({ option }) => (
  <Group gap="xs" wrap="nowrap">
    {renderPropertyTypeIcon(option.value as DatabasePropertyType, 16)}
    <span>{option.label}</span>
  </Group>
);

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

  const createPropertyMutation = useCreateDatabasePropertyMutation(databaseId);
  const createRowMutation = useCreateDatabaseRowMutation(databaseId);
  const updateCellsMutation = useBatchUpdateDatabaseCellsMutation(databaseId);
  const deletePropertyMutation = useDeleteDatabasePropertyMutation(databaseId);
  const deleteRowMutation = useDeleteDatabaseRowMutation(databaseId);
  const updatePropertyMutation = useUpdateDatabasePropertyMutation(databaseId);

  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<DatabasePropertyType>('multiline_text');
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<unknown>('');
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<IDatabaseFilterCondition[]>([DEFAULT_FILTER]);
  const [sortState, setSortState] = useState<IDatabaseSortState | null>(null);
  const [settingsProperty, setSettingsProperty] = useState<IDatabaseProperty | null>(null);
  const [selectPropertyDraft, setSelectPropertyDraft] =
    useState<SelectPropertyCreationDraft | null>(null);
  const setTableExportState = useSetAtom(databaseTableExportStateAtom);
  const treeData = useAtomValue(treeDataAtom);
  const setTreeData = useSetAtom(treeDataAtom);
  const treeApi = useAtomValue(treeApiAtom);
  const emit = useQueryEmit();
  const navigate = useNavigate();

  /**
   * Locates a database node in the local sidebar tree.
   *
   * Table view operates with databaseId, not with tree page id,
   * so we match by nodeType=database and databaseId.
   */
  const findDatabaseNodeInTree = (
    nodes: SpaceTreeNode[],
  ): SpaceTreeNode | null => {
    for (const treeNode of nodes) {
      if (treeNode.nodeType === 'database' && treeNode.databaseId === databaseId) {
        return treeNode;
      }

      const nestedNode = findDatabaseNodeInTree(treeNode.children);
      if (nestedNode) {
        return nestedNode;
      }
    }

    return null;
  };

  const handleCreateRow = async () => {
    const createdRow = await createRowMutation.mutateAsync({});
    const databaseNode = findDatabaseNodeInTree(treeData);

    if (!databaseNode) {
      return;
    }

    const createdRowPage = await queryClient.fetchQuery({
      queryKey: PAGE_QUERY_KEYS.page(createdRow.pageId),
      queryFn: () => getPageById({ pageId: createdRow.pageId }),
    });

    if (createdRowPage?.slugId) {
      queryClient.setQueryData(PAGE_QUERY_KEYS.page(createdRowPage.slugId), createdRowPage);
    }

    const treeNodeData: SpaceTreeNode = {
      id: createdRow.pageId,
      nodeType: 'databaseRow',
      slugId: createdRow.slugId ?? createdRowPage.slugId,
      databaseId: createdRow.databaseId,
      name: '',
      position: '',
      spaceId,
      parentPageId: databaseNode.id,
      icon: null,
      status: null,
      hasChildren: false,
      children: [],
    };

    const wasFirstRow = (databaseNode.children?.length ?? 0) === 0;
    const { tree: nextTreeData, index: insertionIndex } = insertDatabaseRowNode(
      treeData,
      databaseNode.id,
      treeNodeData,
    );
    setTreeData(nextTreeData);

    emit({
      operation: 'addTreeNode',
      spaceId,
      payload: {
        parentId: databaseNode.id,
        index: insertionIndex,
        node: treeNodeData,
      },
    });

    /**
     * UX: when the first row is created, open the database node immediately
     * so the user can see the newly inserted child without manual interaction.
     */
    if (wasFirstRow) {
      treeApi?.open(databaseNode.id);
    }

    /**
     * Optimistic insert keeps UX responsive, but final consistency must always
     * come from the canonical sidebar children payload.
     */
    try {
      const actualChildren = await fetchAllAncestorChildren({
        pageId: databaseNode.id,
        spaceId,
        includeNodeTypes: ['page', 'database', 'databaseRow'],
      });

      setTreeData((currentTreeData) => {
        const treeWithSyncedChildren = appendNodeChildren(
          currentTreeData,
          databaseNode.id,
          actualChildren,
        );

        return setTreeNodeHasChildren(
          treeWithSyncedChildren,
          databaseNode.id,
          actualChildren.length > 0,
        );
      });
    } catch (error) {
      console.error('Failed to synchronize database children after row creation', error);
    }
  };

  /**
   * Localized property type labels for all table selectors.
   * Raw contract values (`multiline_text`, `page_reference`, etc.)
   * are kept internal and never shown directly in the UI.
   */
  const propertyTypeLabels = useMemo<Record<DatabasePropertyType, string>>(
    () =>
      Object.fromEntries(
        Object.entries(DATABASE_PROPERTY_TYPE_LABEL_KEYS).map(([propertyType, i18nKey]) => [
          propertyType,
          t(i18nKey),
        ]),
      ) as Record<DatabasePropertyType, string>,
    [t],
  );

  /**
   * Keeps current table state synchronized with the global store,
   * so header actions (export/markdown copy) use the same filters,
   * sorting and column visibility as the current screen.
   */
  useEffect(() => {
    setTableExportState((prev) => ({
      ...prev,
      [databaseId]: {
        visibleColumns,
        filters,
        sortState,
      },
    }));
  }, [databaseId, filters, setTableExportState, sortState, visibleColumns]);

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

  const getRawCellValue = (row: IDatabaseRowWithCells, propertyId: string): unknown => {
    return row.cells?.find((cell) => cell.propertyId === propertyId)?.value;
  };

  const startEditing = (row: IDatabaseRowWithCells, property: IDatabaseProperty) => {
    if (!isEditable) {
      return;
    }

    const key = `${row.pageId}:${property.id}`;
    setEditingCellKey(key);
    setEditingValue(getRawCellValue(row, property.id));
  };

  /**
   * Normalizes a value according to the property type contract.
   * This keeps the batch update payload format consistent per cell type.
   */
  const buildCellPayloadValue = (property: IDatabaseProperty, value: unknown): unknown => {
    if (property.type === 'checkbox') {
      return Boolean(value);
    }

    if (property.type === 'user') {
      if (value && typeof value === 'object' && 'id' in value) {
        const userId = (value as { id?: unknown }).id;
        return typeof userId === 'string' && userId.trim() ? { id: userId } : null;
      }

      if (typeof value === 'string' && value.trim()) {
        return { id: value.trim() };
      }

      return null;
    }

    if (property.type === 'page_reference') {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    return value ?? '';
  };

  const saveEditing = async (
    row: IDatabaseRowWithCells,
    property: IDatabaseProperty,
    nextValue?: unknown,
  ) => {
    /**
     * For regular fields, we save only from the active edit-state.
     * For checkboxes, we allow direct saving from view mode via nextValue.
     */
    if (!isEditable || (typeof nextValue === 'undefined' && !editingCellKey)) {
      return;
    }

    const sourceValue = typeof nextValue === 'undefined' ? editingValue : nextValue;
    const normalizedValue = buildCellPayloadValue(property, sourceValue);
    const shouldDelete =
      property.type !== 'checkbox' &&
      (normalizedValue === null ||
        normalizedValue === '' ||
        (typeof normalizedValue === 'object' &&
          normalizedValue !== null &&
          'id' in normalizedValue &&
          !(normalizedValue as { id?: string }).id));

    await updateCellsMutation.mutateAsync({
      pageId: row.pageId,
      payload: {
        cells: [
          {
            propertyId: property.id,
            value: shouldDelete ? null : normalizedValue,
            operation: shouldDelete ? 'delete' : 'upsert',
          },
        ],
      },
    });

    setEditingCellKey(null);
    setEditingValue('');
  };


  const getSelectSettings = (property: IDatabaseProperty): IDatabaseSelectPropertySettings => {
    if (!property.settings || typeof property.settings !== 'object') {
      return { options: [] };
    }

    const maybeOptions = (property.settings as { options?: unknown }).options;

    if (!Array.isArray(maybeOptions)) {
      return { options: [] };
    }

    const options: IDatabaseSelectOption[] = maybeOptions
      .filter((option): option is IDatabaseSelectOption => {
        if (!option || typeof option !== 'object') {
          return false;
        }

        const candidate = option as IDatabaseSelectOption;
        return typeof candidate.label === 'string' && typeof candidate.value === 'string';
      })
      .map((option) => ({
        label: option.label,
        value: option.value,
        color: option.color,
      }));

    return { options };
  };

  const getSelectOptionLabel = (property: IDatabaseProperty, value: string): string => {
    const settings = getSelectSettings(property);
    const selectedOption = settings.options.find((option) => option.value === value);

    return selectedOption?.label || value;
  };

  const handleCreateProperty = () => {
    const trimmedName = newPropertyName.trim();

    if (!trimmedName) {
      return;
    }

    if (newPropertyType === 'select') {
      setSelectPropertyDraft({
        name: trimmedName,
        initialSettings: {
          options: [{ label: '', value: '', color: 'gray' }],
        },
      });
      return;
    }

    createPropertyMutation.mutate({
      name: trimmedName,
      type: newPropertyType,
    });
    setNewPropertyName('');
    setNewPropertyType('multiline_text');
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
          <Select
            w={180}
            value={newPropertyType}
            data={DATABASE_PROPERTY_TYPES.map((propertyType) => ({
              value: propertyType,
              label: propertyTypeLabels[propertyType],
            }))}
            onChange={(value) => {
              if (!value) {
                return;
              }

              setNewPropertyType(value as DatabasePropertyType);
            }}
            disabled={!isEditable}
            allowDeselect={false}
            renderOption={renderPropertyTypeOption}
            leftSection={renderPropertyTypeIcon(newPropertyType, 16)}
          />
          <Button
            leftSection={<IconPlus size={14} />}
            disabled={!isEditable}
            onClick={handleCreateProperty}
          >
            {t('Property')}
          </Button>

          <Button
            variant="light"
            leftSection={<IconPlus size={14} />}
            disabled={!isEditable}
            onClick={() => void handleCreateRow()}
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
        <Table
            stickyHeader
            withTableBorder
            withColumnBorders
            miw={900}
            layout="auto"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th miw={280}>{t('Title')}</Table.Th>
              {displayedProperties.map((property) => (
                <Table.Th key={property.id} miw={220}>
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm">{property.name}</Text>
                    {isEditable && (
                      <Menu position="bottom-end" shadow="md" withinPortal>
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label={t('Property actions')}
                          >
                            <IconDotsVertical size={14} />
                          </ActionIcon>
                        </Menu.Target>

                        <Menu.Dropdown>
                          <Menu.Sub>
                            <Menu.Sub.Target>
                              <Menu.Sub.Item leftSection={<IconSwitchHorizontal size={14} />}>
                                {t('Type')}
                              </Menu.Sub.Item>
                            </Menu.Sub.Target>
                            <Menu.Sub.Dropdown>
                              {DATABASE_PROPERTY_TYPES.map((propertyType) => (
                                <Menu.Item
                                  key={`${property.id}-${propertyType}`}
                                  leftSection={renderPropertyTypeIcon(propertyType, 14)}
                                  disabled={propertyType === property.type}
                                  onClick={() =>
                                    updatePropertyMutation.mutate({
                                      propertyId: property.id,
                                      payload: { type: propertyType },
                                    })
                                  }
                                >
                                  {propertyTypeLabels[propertyType]}
                                </Menu.Item>
                              ))}
                            </Menu.Sub.Dropdown>
                          </Menu.Sub>
                          {property.type === 'select' && (
                            <Menu.Item
                              leftSection={<IconSettings size={14} />}
                              onClick={() => setSettingsProperty(property)}
                            >
                              {t('Select settings')}
                            </Menu.Item>
                          )}
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => deletePropertyMutation.mutate(property.id)}
                          >
                            {t('Delete property with name', { name: property.name })}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
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

                  </div>

                  <Menu position="bottom-end" shadow="md" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        aria-label={t('Row actions')}
                      >
                        <IconDotsVertical size={14} />
                      </ActionIcon>
                    </Menu.Target>

                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconMessageCircle size={14} />}
                        onClick={() =>
                          navigate(`/s/${spaceSlug}/p/${row.pageId}`, {
                            state: { openCommentsAside: true },
                          })
                        }
                      >
                        {t('Row comments')}
                      </Menu.Item>

                      {isEditable && (
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => deleteRowMutation.mutate(row.pageId)}
                        >
                          {t('Delete row')}
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                  </Group>
                </Table.Td>

                {displayedProperties.map((property) => {
                  const key = `${row.pageId}:${property.id}`;
                  const isEditing = editingCellKey === key;

                  return (
                    <Table.Td key={property.id}>
                      <DatabaseCellRenderer
                        property={property}
                        value={getRawCellValue(row, property.id)}
                        isEditable={isEditable}
                        isEditing={isEditing}
                        editingValue={editingValue}
                        spaceId={spaceId}
                        spaceSlug={spaceSlug}
                        getSelectOptionLabel={getSelectOptionLabel}
                        onStartEdit={() => startEditing(row, property)}
                        onChange={setEditingValue}
                        onSave={(nextValue) => saveEditing(row, property, nextValue)}
                      />
                    </Table.Td>
                  );
                })}

              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <SelectPropertySettingsModal
        opened={Boolean(settingsProperty || selectPropertyDraft)}
        propertyName={settingsProperty?.name || selectPropertyDraft?.name || ''}
        initialSettings={
          settingsProperty
            ? getSelectSettings(settingsProperty)
            : selectPropertyDraft?.initialSettings || { options: [] }
        }
        onClose={() => {
          setSettingsProperty(null);
          setSelectPropertyDraft(null);
        }}
        onSave={async (settings) => {
          if (settingsProperty) {
            await updatePropertyMutation.mutateAsync({
              propertyId: settingsProperty.id,
              payload: { settings },
            });
            return;
          }

          if (!selectPropertyDraft) {
            return;
          }

          await createPropertyMutation.mutateAsync({
            name: selectPropertyDraft.name,
            type: 'select',
            settings: {
              options: settings.options,
            },
          });
          setNewPropertyName('');
          setNewPropertyType('multiline_text');
        }}
      />
    </Paper>
  );
}
