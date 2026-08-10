import {
  Checkbox,
  Button,
  Drawer,
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
import { useMediaQuery } from '@mantine/hooks';
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
  IconArrowLeft,
  IconArrowRight,
  IconCode,
  IconList,
  IconPencil,
  type TablerIcon,
  IconFileDescription,
  IconGripVertical,
} from '@tabler/icons-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATABASE_PROPERTY_TYPES, DatabasePropertyType } from '@docmost/api-contract';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { useAtomValue } from 'jotai/react';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import {
  useBatchUpdateDatabaseRowsMutation,
  useBatchUpdateDatabaseCellsMutation,
  useCreateDatabasePropertyMutation,
  useCreateDatabaseRowMutation,
  useDeleteDatabasePropertyMutation,
  useDeleteDatabaseViewMutation,
  useDatabasePropertiesQuery,
  useDatabaseViewsQuery,
  useCreateDatabaseViewMutation,
  useUpdateDatabaseRowMutation,
  useUpdateDatabasePropertyMutation,
  useUpdateDatabaseViewMutation,
  useDatabaseRowsQuery,
} from '@/features/database/queries/database-table-query';
import {
  IDatabaseFilterCondition,
  IDatabaseRowsQueryParams,
  IDatabaseRowsSortDirection,
  IDatabaseRowWithCells,
  IDatabaseSortState,
} from '@/features/database/types/database-table.types';
import {
  IDatabaseProperty,
  IDatabaseSelectPropertySettings,
  IDatabaseViewConfig,
} from '@/features/database/types/database.types';
import { SelectPropertySettingsModal } from '@/features/database/components/select-property-settings-modal';
import {
  defaultDatabaseTableExportState,
  databaseTableExportStateAtom,
} from '@/features/database/atoms/database-table-export-atom';
import { getRowTitle } from '@/features/database/utils/database-markdown';
import { DATABASE_PROPERTY_TYPE_LABEL_KEYS } from '@/features/database/utils/database-property-type-labels';
import { DatabaseCellRenderer } from '@/features/database/components/database-cell-renderer.tsx';
import { useDictionaryTermsQuery } from '@/features/dictionary/queries/dictionary-query';
import { DictionaryHighlightLayer } from '@/features/dictionary/components/dictionary-highlight-layer';
import { createDictionaryMatcherIndex } from '@/features/dictionary/utils/dictionary-matcher';
import { treeDataAtom } from '@/features/page/tree/atoms/tree-data-atom.ts';
import { SpaceTreeNode } from '@/features/page/tree/types.ts';
import { treeApiAtom } from '@/features/page/tree/atoms/tree-api-atom.ts';
import { useQueryEmit } from '@/features/websocket/use-query-emit.ts';
import {
  appendNodeChildren,
  dropTreeNode,
  insertDatabaseRowNode,
  setTreeNodeHasChildren,
} from '@/features/page/tree/utils/utils.ts';
import { SimpleTree } from 'react-arborist';
import { queryClient } from '@/main.tsx';
import {
  duplicatePage,
  getAllSidebarPages,
  getPageById,
} from '@/features/page/services/page-service.ts';
import { DATABASE_QUERY_KEYS, PAGE_QUERY_KEYS } from '@/features/page/queries/query-keys.ts';
import { ISidebarNode } from '@/features/page/types/page.types.ts';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import { fetchAllAncestorChildren } from '@/features/page/queries/page-query.ts';
import {
  buildDatabaseCellPayloadValue,
  extractCurrentDatabaseCellValue,
  getDatabaseSelectSettings,
} from '@/features/database/utils/database-cell-value.ts';
import {
  DATABASE_PROPERTY_DRAG_MIME,
  getSelectedPreparedRowIds,
  isDatabaseFilterControlsVisible,
  getCheckboxFilterOptions,
  isSameCellPayloadValue,
  mergePinnedDatabaseRow,
  normalizeDatabaseViewConfig,
  reorderDatabaseProperties,
  resolveDraggedDatabasePropertyId,
  resolveDatabasePropertyRename,
  shouldHandleDatabaseMatrixPaste,
  shouldShowDatabaseFilterRemove,
  shouldDeleteCellPayload,
} from '@/features/database/components/database-table-view.helpers.ts';
import { userAtom } from '@/features/user/atoms/current-user-atom.ts';
import { PageEditMode } from '@/features/user/types/user.types.ts';
import { buildPageEditModeByPageId } from '@/features/user/utils/page-edit-mode.ts';
import classes from './database-table-view.module.css';
import MovePageModal from '@/features/page/components/move-page-modal.tsx';
import CopyPageModal from '@/features/page/components/copy-page-modal.tsx';
import { PageOperationMenuItems } from '@/features/page/components/page-operation-menu-items.tsx';
import { invalidateSidebarTree } from '@/features/page/queries/cache-invalidation.ts';
import { DatabaseFilterEditor } from './database-filter-editor';
import { AccessibleActionIcon } from '@/components/ui/accessible-action-icon';

interface DatabaseTableViewProps {
  databaseId: string;
  spaceId: string;
  spaceSlug: string;
  isEditable?: boolean;
  dictionaryEnabled?: boolean;
  canManageDictionary?: boolean;
}

interface SelectPropertyCreationDraft {
  name: string;
  initialSettings: IDatabaseSelectPropertySettings;
}

interface IPersistedDatabaseTableState {
  filters: IDatabaseFilterCondition[];
  sortState: IDatabaseSortState | null;
  selectedViewId?: string | null;
}

const DEFAULT_FILTER: IDatabaseFilterCondition = defaultDatabaseTableExportState.filters[0];
const ROWS_PAGE_SIZE = 100;
const MAX_FILTERS = 10;
const DELETE_GRACE_PERIOD_MS = 6000;
const ROW_VIRTUALIZATION_MIN_ROWS = 100;
const ROW_VIRTUALIZATION_ESTIMATED_HEIGHT = 48;
const ROW_VIRTUALIZATION_OVERSCAN = 8;
const DATABASE_TABLE_STATE_STORAGE_PREFIX = 'docmost:database-table-state';

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
 * - filtering and single-field sorting.
 */
export function DatabaseTableView({
  databaseId,
  spaceId,
  spaceSlug,
  isEditable = true,
  dictionaryEnabled = false,
  canManageDictionary = false,
}: DatabaseTableViewProps) {
  const { t } = useTranslation();
  const { data: properties = [] } = useDatabasePropertiesQuery(databaseId);
  const { data: databaseViews = [], isSuccess: areDatabaseViewsLoaded } =
    useDatabaseViewsQuery(databaseId);
  const { data: dictionaryTerms = [] } = useDictionaryTermsQuery(
    spaceId,
    dictionaryEnabled,
  );
  const activeDictionaryTerms = useMemo(
    () => (dictionaryEnabled ? dictionaryTerms : []),
    [dictionaryEnabled, dictionaryTerms],
  );
  const dictionaryMatcherIndex = useMemo(
    () => createDictionaryMatcherIndex(activeDictionaryTerms),
    [activeDictionaryTerms],
  );
  const [rowsCursor, setRowsCursor] = useState<string | null>(null);

  const createPropertyMutation = useCreateDatabasePropertyMutation(databaseId);
  const createRowMutation = useCreateDatabaseRowMutation(databaseId);
  const updateCellsMutation = useBatchUpdateDatabaseCellsMutation(databaseId);
  const batchUpdateRowsMutation = useBatchUpdateDatabaseRowsMutation(databaseId);
  const deletePropertyMutation = useDeleteDatabasePropertyMutation(databaseId);
  const updatePropertyMutation = useUpdateDatabasePropertyMutation(databaseId);
  const updateRowMutation = useUpdateDatabaseRowMutation(databaseId);
  const createViewMutation = useCreateDatabaseViewMutation(databaseId);
  const updateViewMutation = useUpdateDatabaseViewMutation(databaseId);
  const deleteViewMutation = useDeleteDatabaseViewMutation(databaseId);
  const batchUpdateRowsMutationRef = useRef(batchUpdateRowsMutation);
  const deletePropertyMutationRef = useRef(deletePropertyMutation);

  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<DatabasePropertyType>('multiline_text');
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<unknown>('');
  const [rows, setRows] = useState<IDatabaseRowWithCells[]>([]);
  const [optimisticallyDeletedRowPageIds, setOptimisticallyDeletedRowPageIds] =
    useState<Record<string, boolean>>({});
  const [optimisticallyDeletedPropertyIds, setOptimisticallyDeletedPropertyIds] =
    useState<Record<string, boolean>>({});
  const [viewControlsOpened, setViewControlsOpened] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<IDatabaseFilterCondition[]>([DEFAULT_FILTER]);
  const [sortState, setSortState] = useState<IDatabaseSortState | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [viewNameDraft, setViewNameDraft] = useState('');
  const activeServerFilters = useMemo(
    () =>
      filters.filter((condition) => condition.propertyId && condition.value),
    [filters],
  );
  const serializedServerFilters = useMemo(
    () =>
      activeServerFilters.length > 0
        ? JSON.stringify(activeServerFilters)
        : undefined,
    [activeServerFilters],
  );
  const rowsExportQueryParams = useMemo<IDatabaseRowsQueryParams>(
    () => ({
      sortField: sortState ? undefined : 'position',
      sortDirection: sortState?.direction ?? 'asc',
      sortPropertyId: sortState?.propertyId ?? undefined,
      filters: serializedServerFilters,
    }),
    [serializedServerFilters, sortState],
  );
  const rowsQueryParams = useMemo<IDatabaseRowsQueryParams>(
    () => ({
      ...rowsExportQueryParams,
      limit: ROWS_PAGE_SIZE,
      cursor: rowsCursor ?? undefined,
    }),
    [rowsCursor, rowsExportQueryParams],
  );
  const rowsServerStateSignature = useMemo(
    () =>
      `${serializedServerFilters ?? ''}|${sortState?.propertyId ?? ''}|${sortState?.direction ?? ''}`,
    [serializedServerFilters, sortState],
  );
  const { data: rowsPage, isFetching: isRowsFetching } = useDatabaseRowsQuery(
    databaseId,
    rowsQueryParams,
  );
  const [settingsProperty, setSettingsProperty] = useState<IDatabaseProperty | null>(null);
  const [propertyNameDrafts, setPropertyNameDrafts] = useState<Record<string, string>>({});
  const [renamingRowPageId, setRenamingRowPageId] = useState<string | null>(null);
  const [renamingRowInitialTitle, setRenamingRowInitialTitle] = useState('');
  const [renamingRowTitleDraft, setRenamingRowTitleDraft] = useState('');
  const [pinnedCreatedRow, setPinnedCreatedRow] =
    useState<IDatabaseRowWithCells | null>(null);
  const [draggedPropertyId, setDraggedPropertyId] = useState<string | null>(null);
  const [dragOverPropertyId, setDragOverPropertyId] = useState<string | null>(null);
  const draggedPropertyIdRef = useRef<string | null>(null);
  const [movingRow, setMovingRow] = useState<IDatabaseRowWithCells | null>(null);
  const [copyingRow, setCopyingRow] = useState<IDatabaseRowWithCells | null>(null);
  const [selectedRowPageIds, setSelectedRowPageIds] = useState<Record<string, boolean>>({});
  const [bulkPropertyId, setBulkPropertyId] = useState<string | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkCheckboxValue, setBulkCheckboxValue] = useState<'true' | 'false'>('true');
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [selectPropertyDraft, setSelectPropertyDraft] =
    useState<SelectPropertyCreationDraft | null>(null);
  const hasRestoredTableStateRef = useRef(false);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const pendingRowDeletionsRef = useRef<
    Map<string, { timeoutId: ReturnType<typeof setTimeout>; rowIds: string[] }>
  >(new Map());
  const pendingPropertyDeletionsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const isMobileViewport = useMediaQuery('(max-width: 767px)');
  const setTableExportState = useSetAtom(databaseTableExportStateAtom);
  const treeData = useAtomValue(treeDataAtom);
  const setTreeData = useSetAtom(treeDataAtom);
  const treeApi = useAtomValue(treeApiAtom);
  const user = useAtomValue(userAtom);
  const setUser = useSetAtom(userAtom);
  const emit = useQueryEmit();
  const navigate = useNavigate();
  const tableStateStorageKey = useMemo(
    () => `${DATABASE_TABLE_STATE_STORAGE_PREFIX}:${databaseId}`,
    [databaseId],
  );

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

  const emitDatabaseInvalidation = ({
    invalidateProperties = false,
    invalidateRows = true,
    invalidateRowContext = true,
  }: {
    invalidateProperties?: boolean;
    invalidateRows?: boolean;
    invalidateRowContext?: boolean;
  } = {}) => {
    if (invalidateProperties) {
      emit({
        operation: "invalidate",
        spaceId,
        entity: ["database", databaseId, "properties"],
      });
    }

    if (invalidateRows) {
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...DATABASE_QUERY_KEYS.rowsBase(databaseId)],
      });
    }

    if (invalidateRowContext) {
      emit({
        operation: "invalidate",
        spaceId,
        entity: ["database", "row-context"],
      });
    }
  };

  const cloneDefaultFilter = (): IDatabaseFilterCondition => ({
    ...DEFAULT_FILTER,
  });

  const resetRowsPagination = useCallback(() => {
    setRowsCursor(null);
    setTableScrollTop(0);
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    queryClient.invalidateQueries({
      queryKey: DATABASE_QUERY_KEYS.rowsBase(databaseId),
    });
  }, [databaseId]);

  useEffect(() => {
    batchUpdateRowsMutationRef.current = batchUpdateRowsMutation;
  }, [batchUpdateRowsMutation]);

  useEffect(() => {
    deletePropertyMutationRef.current = deletePropertyMutation;
  }, [deletePropertyMutation]);

  useEffect(() => {
    setRowsCursor(null);
    setRows([]);
    setOptimisticallyDeletedRowPageIds({});
    setOptimisticallyDeletedPropertyIds({});
    setSelectedRowPageIds({});
    setPinnedCreatedRow(null);
    setRenamingRowPageId(null);
    setRenamingRowInitialTitle('');
    setRenamingRowTitleDraft('');
    draggedPropertyIdRef.current = null;
    setDraggedPropertyId(null);
    setDragOverPropertyId(null);
    setTableScrollTop(0);
  }, [databaseId]);

  useEffect(() => {
    hasRestoredTableStateRef.current = false;
    const fallbackFilters: IDatabaseFilterCondition[] = [{ ...DEFAULT_FILTER }];

    if (typeof window === 'undefined') {
      setFilters(fallbackFilters);
      setSortState(null);
      setSelectedViewId(null);
      hasRestoredTableStateRef.current = true;
      return;
    }

    const rawState = window.localStorage.getItem(tableStateStorageKey);
    if (!rawState) {
      setFilters(fallbackFilters);
      setSortState(null);
      setSelectedViewId(null);
      hasRestoredTableStateRef.current = true;
      return;
    }

    try {
      const parsedState = JSON.parse(rawState) as Partial<IPersistedDatabaseTableState>;
      const normalizedFilters = Array.isArray(parsedState.filters)
        ? parsedState.filters
            .filter((item): item is IDatabaseFilterCondition => Boolean(item))
            .map((item) => ({
              propertyId: typeof item.propertyId === 'string' ? item.propertyId : '',
              operator:
                item.operator === 'equals' ||
                item.operator === 'not_equals' ||
                item.operator === 'contains'
                  ? item.operator
                  : 'contains',
              value: typeof item.value === 'string' ? item.value : '',
            }))
            .slice(0, MAX_FILTERS)
        : [];
      const normalizedSortState =
        parsedState.sortState &&
        typeof parsedState.sortState === 'object' &&
        typeof parsedState.sortState.propertyId === 'string' &&
        (parsedState.sortState.direction === 'asc' || parsedState.sortState.direction === 'desc')
          ? {
              propertyId: parsedState.sortState.propertyId,
              direction: parsedState.sortState.direction,
            }
          : null;

      setFilters(normalizedFilters.length > 0 ? normalizedFilters : fallbackFilters);
      setSortState(normalizedSortState);
      setSelectedViewId(
        typeof parsedState.selectedViewId === 'string'
          ? parsedState.selectedViewId
          : null,
      );
    } catch {
      window.localStorage.removeItem(tableStateStorageKey);
      setFilters(fallbackFilters);
      setSortState(null);
      setSelectedViewId(null);
    }

    hasRestoredTableStateRef.current = true;
  }, [tableStateStorageKey]);

  useEffect(() => {
    if (!hasRestoredTableStateRef.current || typeof window === 'undefined') {
      return;
    }

    const stateToPersist: IPersistedDatabaseTableState = {
      filters,
      sortState,
      selectedViewId,
    };

    window.localStorage.setItem(tableStateStorageKey, JSON.stringify(stateToPersist));
  }, [filters, selectedViewId, sortState, tableStateStorageKey]);

  useEffect(() => {
    if (!hasRestoredTableStateRef.current) {
      return;
    }

    setSelectedRowPageIds({});
    resetRowsPagination();
  }, [resetRowsPagination, rowsServerStateSignature]);

  useEffect(() => {
    const viewport = tableViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportHeight = () => {
      setTableViewportHeight(viewport.clientHeight);
    };

    updateViewportHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [isMobileViewport]);

  useEffect(() => {
    if (!rowsPage) {
      return;
    }

    setRows((previousRows) => {
      const incomingRows = rowsPage.items ?? [];
      if (!rowsCursor) {
        return incomingRows;
      }

      const rowsByPageId = new Map(previousRows.map((row) => [row.pageId, row]));
      for (const incomingRow of incomingRows) {
        rowsByPageId.set(incomingRow.pageId, incomingRow);
      }

      return [...rowsByPageId.values()];
    });
  }, [rowsCursor, rowsPage]);

  useEffect(
    () => () => {
      const pendingRowDeletions = [...pendingRowDeletionsRef.current.entries()];
      pendingRowDeletionsRef.current.clear();
      for (const [token, pendingDeletion] of pendingRowDeletions) {
        clearTimeout(pendingDeletion.timeoutId);
        notifications.hide(`database-row-delete-${token}`);
      }

      const pendingRowIds = [
        ...new Set(
          pendingRowDeletions.flatMap(([, pendingDeletion]) => pendingDeletion.rowIds),
        ),
      ];

      if (pendingRowIds.length > 0) {
        void batchUpdateRowsMutationRef.current
          .mutateAsync({
            rows: pendingRowIds.map((pageId) => ({
              pageId,
              operation: 'delete_row' as const,
            })),
          })
          .catch(() => undefined);
      }

      const pendingPropertyDeletions = [...pendingPropertyDeletionsRef.current.entries()];
      pendingPropertyDeletionsRef.current.clear();
      const pendingPropertyIds = pendingPropertyDeletions.map(([propertyId]) => propertyId);
      for (const [propertyId, timeoutId] of pendingPropertyDeletions) {
        clearTimeout(timeoutId);
        notifications.hide(`database-property-delete-${propertyId}`);
      }

      if (pendingPropertyIds.length > 0) {
        void Promise.allSettled(
          pendingPropertyIds.map((propertyId) =>
            deletePropertyMutationRef.current.mutateAsync(propertyId),
          ),
        );
      }
    },
    [],
  );

  const handleCreateRow = async () => {
    if (createRowMutation.isPending || pinnedCreatedRow) {
      return;
    }

    const createdRow = await createRowMutation.mutateAsync({});
    emitDatabaseInvalidation();
    if (user) {
      setUser({
        ...user,
        settings: {
          ...user.settings,
          preferences: {
            ...user.settings?.preferences,
            pageEditModeByPageId: buildPageEditModeByPageId(
              user.settings?.preferences?.pageEditModeByPageId,
              createdRow.pageId,
              PageEditMode.Edit,
            ),
          },
        },
      });
    }

    const createdRowPage = await queryClient.fetchQuery({
      queryKey: PAGE_QUERY_KEYS.page(createdRow.pageId),
      queryFn: () => getPageById({ pageId: createdRow.pageId }),
    });

    if (createdRowPage?.slugId) {
      queryClient.setQueryData(PAGE_QUERY_KEYS.page(createdRowPage.slugId), createdRowPage);
    }

    const createdRowTitle = createdRowPage?.title ?? '';
    const optimisticRow: IDatabaseRowWithCells = {
      id: createdRow.id,
      pageId: createdRow.pageId,
      pageTitle: createdRowTitle,
      page: {
        id: createdRowPage.id,
        slugId: createdRow.slugId ?? createdRowPage.slugId,
        title: createdRowTitle,
        icon: createdRowPage.icon,
        parentPageId: createdRowPage.parentPageId,
        position: createdRowPage.position,
        customFields: createdRowPage.customFields,
      },
      cells: [],
    };

    setPinnedCreatedRow(optimisticRow);
    setRenamingRowPageId(createdRow.pageId);
    setRenamingRowInitialTitle(createdRowTitle);
    setRenamingRowTitleDraft(createdRowTitle);
    setTableScrollTop(0);
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }

    const databaseNode = findDatabaseNodeInTree(treeData);

    if (!databaseNode) {
      resetRowsPagination();
      return;
    }

    const treeNodeData: SpaceTreeNode = {
      id: createdRow.pageId,
      nodeType: 'databaseRow',
      slugId: createdRow.slugId ?? createdRowPage.slugId,
      databaseId: createdRow.databaseId,
      name: createdRowTitle,
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

    resetRowsPagination();
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
        rowsQueryParams: rowsExportQueryParams,
      },
    }));
  }, [databaseId, filters, rowsExportQueryParams, setTableExportState, sortState, visibleColumns]);

  useEffect(() => {
    setPropertyNameDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const property of properties) {
        next[property.id] = prev[property.id] ?? property.name;
      }

      return next;
    });
  }, [properties]);

  useEffect(() => {
    if (!renamingRowPageId) {
      return;
    }

    const hasRow =
      pinnedCreatedRow?.pageId === renamingRowPageId ||
      rows.some(
        (row) =>
          row.pageId === renamingRowPageId &&
          !optimisticallyDeletedRowPageIds[row.pageId],
      );
    if (!hasRow) {
      setRenamingRowPageId(null);
      setRenamingRowInitialTitle('');
      setRenamingRowTitleDraft('');
    }
  }, [
    optimisticallyDeletedRowPageIds,
    pinnedCreatedRow?.pageId,
    renamingRowPageId,
    rows,
  ]);

  const checkboxFilterOptions = useMemo(
    () => getCheckboxFilterOptions(t),
    [t],
  );

  const getRawCellValue = (row: IDatabaseRowWithCells, propertyId: string): unknown => {
    return row.cells?.find((cell) => cell.propertyId === propertyId)?.value;
  };

  const hasEffectiveCellValueChange = (
    row: IDatabaseRowWithCells,
    property: IDatabaseProperty,
    sourceValue: unknown,
  ): { shouldDelete: boolean; normalizedValue: unknown } | null => {
    const normalizedValue = buildDatabaseCellPayloadValue(property, sourceValue);
    const shouldDelete = shouldDeleteCellPayload(property.type, normalizedValue);
    const currentNormalizedValue = buildDatabaseCellPayloadValue(
      property,
      getRawCellValue(row, property.id),
    );
    const currentShouldDelete = shouldDeleteCellPayload(property.type, currentNormalizedValue);
    const nextPersistedValue = shouldDelete ? null : normalizedValue;
    const currentPersistedValue = currentShouldDelete ? null : currentNormalizedValue;

    if (
      shouldDelete === currentShouldDelete &&
      isSameCellPayloadValue(nextPersistedValue, currentPersistedValue)
    ) {
      return null;
    }

    return { shouldDelete, normalizedValue };
  };

  const getPersistedRowTitle = (row: IDatabaseRowWithCells): string => {
    return row.page?.title ?? row.pageTitle ?? '';
  };

  const activeProperties = useMemo(
    () =>
      properties.filter((property) => !optimisticallyDeletedPropertyIds[property.id]),
    [optimisticallyDeletedPropertyIds, properties],
  );

  useEffect(() => {
    if (!selectedViewId || !areDatabaseViewsLoaded) {
      return;
    }

    const selectedView = databaseViews.find((view) => view.id === selectedViewId);
    if (!selectedView) {
      setSelectedViewId(null);
      setViewNameDraft('');
      return;
    }

    const normalizedConfig = normalizeDatabaseViewConfig(
      selectedView.config,
      activeProperties.map((property) => property.id),
    );
    setViewNameDraft(selectedView.name);
    setFilters(
      normalizedConfig.filters.length > 0
        ? normalizedConfig.filters
        : [{ ...DEFAULT_FILTER }],
    );
    setSortState(normalizedConfig.sortState);
    setVisibleColumns(normalizedConfig.visibleColumns);
  }, [
    activeProperties,
    areDatabaseViewsLoaded,
    databaseViews,
    selectedViewId,
  ]);

  const saveCurrentView = async () => {
    const name = viewNameDraft.trim();
    if (!name) {
      return;
    }

    const config: IDatabaseViewConfig = {
      filters,
      sortState,
      visibleColumns,
    };

    try {
      if (selectedViewId) {
        await updateViewMutation.mutateAsync({
          viewId: selectedViewId,
          payload: { name, type: 'table', config },
        });
        return;
      }

      const createdView = await createViewMutation.mutateAsync({
        name,
        type: 'table',
        config,
      });
      setSelectedViewId(createdView.id);
    } catch {
      // The shared API error handler reports the failure. Keep the current draft.
    }
  };

  const deleteCurrentView = async () => {
    if (!selectedViewId) {
      return;
    }

    try {
      await deleteViewMutation.mutateAsync(selectedViewId);
      setSelectedViewId(null);
      setViewNameDraft('');
    } catch {
      // The shared API error handler reports the failure. Keep the selected view.
    }
  };

  const visibleRows = useMemo(
    () =>
      mergePinnedDatabaseRow(
        rows.filter((row) => !optimisticallyDeletedRowPageIds[row.pageId]),
        pinnedCreatedRow,
      ),
    [optimisticallyDeletedRowPageIds, pinnedCreatedRow, rows],
  );

  useEffect(() => {
    const activePropertyIds = new Set(activeProperties.map((property) => property.id));

    setFilters((previousFilters) => {
      const nextFilters = previousFilters.filter(
        (condition) => !condition.propertyId || activePropertyIds.has(condition.propertyId),
      );

      if (nextFilters.length === 0) {
        return [cloneDefaultFilter()];
      }

      return nextFilters.length === previousFilters.length
        ? previousFilters
        : nextFilters;
    });

    setSortState((previousSortState) => {
      if (!previousSortState) {
        return previousSortState;
      }

      return activePropertyIds.has(previousSortState.propertyId)
        ? previousSortState
        : null;
    });

    setBulkPropertyId((previousPropertyId) => {
      if (!previousPropertyId) {
        return previousPropertyId;
      }

      return activePropertyIds.has(previousPropertyId)
        ? previousPropertyId
        : null;
    });
  }, [activeProperties]);

  const displayedProperties = useMemo(
    () =>
      activeProperties.filter((property) => {
        const explicitValue = visibleColumns[property.id];
        return typeof explicitValue === 'boolean' ? explicitValue : true;
      }),
    [activeProperties, visibleColumns],
  );

  const moveProperty = async (
    movedPropertyId: string,
    targetPropertyId: string,
  ) => {
    if (!isEditable || updatePropertyMutation.isPending) {
      return;
    }

    const previousProperties = properties;
    const reorderedProperties = reorderDatabaseProperties(
      previousProperties,
      movedPropertyId,
      targetPropertyId,
    );
    if (reorderedProperties === previousProperties) {
      return;
    }

    const movedProperty = reorderedProperties.find(
      (property) => property.id === movedPropertyId,
    );
    if (!movedProperty) {
      return;
    }

    queryClient.setQueryData(
      DATABASE_QUERY_KEYS.properties(databaseId),
      reorderedProperties,
    );

    try {
      await updatePropertyMutation.mutateAsync({
        propertyId: movedPropertyId,
        payload: { position: movedProperty.position },
      });
      emitDatabaseInvalidation({
        invalidateProperties: true,
        invalidateRows: false,
        invalidateRowContext: true,
      });
    } catch {
      queryClient.setQueryData(
        DATABASE_QUERY_KEYS.properties(databaseId),
        previousProperties,
      );
      notifications.show({
        color: 'red',
        message: t('Failed to update data'),
      });
    }
  };

  const clearPropertyDragState = () => {
    draggedPropertyIdRef.current = null;
    setDraggedPropertyId(null);
    setDragOverPropertyId(null);
  };

  const getPropertyIdAtPoint = (clientX: number, clientY: number) =>
    document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-database-property-id]')?.dataset
      .databasePropertyId ?? null;

  const movePropertyByVisibleOffset = (
    propertyId: string,
    offset: -1 | 1,
  ) => {
    const currentIndex = displayedProperties.findIndex(
      (property) => property.id === propertyId,
    );
    const targetProperty = displayedProperties[currentIndex + offset];
    if (!targetProperty) {
      return;
    }

    void moveProperty(propertyId, targetProperty.id);
  };

  const hasPageReferenceColumn = useMemo(
    () => displayedProperties.some((property) => property.type === 'page_reference'),
    [displayedProperties],
  );
  const allPagesQuery = useQuery({
    queryKey: [...PAGE_QUERY_KEYS.rootSidebar(spaceId, ['page', 'database']), 'all-pages'],
    queryFn: () =>
      getAllSidebarPages({
        spaceId,
        includeNodeTypes: ['page', 'database'],
      }),
    enabled: Boolean(spaceId && hasPageReferenceColumn),
  });
  const allPageNodes = useMemo<ISidebarNode[]>(
    () => allPagesQuery.data?.pages.flatMap((queryPage) => queryPage.items) ?? [],
    [allPagesQuery.data?.pages],
  );
  const pageReferenceOptions = useMemo(
    () =>
      allPageNodes.map((node) => ({
        value: node.id,
        label: node.title || t('untitled'),
      })),
    [allPageNodes, t],
  );
  const pageReferenceUrlById = useMemo(
    () =>
      new Map(
        allPageNodes.map((node) => [
          node.id,
          node.slugId
            ? buildPageUrl(spaceSlug, node.slugId, node.title || t('untitled'))
            : null,
        ]),
      ),
    [allPageNodes, spaceSlug, t],
  );

  const preparedRows = useMemo(
    () => visibleRows,
    [visibleRows],
  );

  const virtualizedRows = useMemo(() => {
    if (
      preparedRows.length < ROW_VIRTUALIZATION_MIN_ROWS ||
      tableViewportHeight <= 0
    ) {
      return {
        rows: preparedRows,
        startIndex: 0,
        topOffset: 0,
        bottomOffset: 0,
      };
    }

    const visibleRowCount = Math.max(
      1,
      Math.ceil(tableViewportHeight / ROW_VIRTUALIZATION_ESTIMATED_HEIGHT),
    );
    const requestedStartIndex = Math.max(
      0,
      Math.floor(tableScrollTop / ROW_VIRTUALIZATION_ESTIMATED_HEIGHT) -
        ROW_VIRTUALIZATION_OVERSCAN,
    );
    const maxStartIndex = Math.max(0, preparedRows.length - visibleRowCount);
    const startIndex = Math.min(requestedStartIndex, maxStartIndex);
    const endIndex = Math.min(
      preparedRows.length,
      startIndex + visibleRowCount + ROW_VIRTUALIZATION_OVERSCAN * 2,
    );

    return {
      rows: preparedRows.slice(startIndex, endIndex),
      startIndex,
      topOffset: startIndex * ROW_VIRTUALIZATION_ESTIMATED_HEIGHT,
      bottomOffset: Math.max(
        0,
        (preparedRows.length - endIndex) * ROW_VIRTUALIZATION_ESTIMATED_HEIGHT,
      ),
    };
  }, [preparedRows, tableScrollTop, tableViewportHeight]);

  const activeFilterCount = activeServerFilters.length;

  const selectedRowIds = useMemo(
    () => getSelectedPreparedRowIds(selectedRowPageIds, preparedRows),
    [preparedRows, selectedRowPageIds],
  );

  useEffect(() => {
    if (isEditable) {
      return;
    }

    setSelectedRowPageIds({});
  }, [isEditable]);

  useEffect(() => {
    if (!editingCellKey) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const activeCell = Array.from(
        tableViewportRef.current?.querySelectorAll<HTMLElement>(
          '[data-database-cell-key]',
        ) ?? [],
      ).find((cell) => cell.dataset.databaseCellKey === editingCellKey);
      const editor = activeCell?.querySelector<HTMLElement>(
        'textarea, input, button, [role="combobox"], [tabindex]:not([tabindex="-1"])',
      );

      (editor ?? activeCell)?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [editingCellKey]);

  useEffect(() => {
    if (Object.keys(optimisticallyDeletedRowPageIds).length === 0) {
      return;
    }

    setSelectedRowPageIds((previousSelection) => {
      const nextSelection = { ...previousSelection };
      let hasChanges = false;

      for (const pageId of Object.keys(nextSelection)) {
        if (!optimisticallyDeletedRowPageIds[pageId]) {
          continue;
        }

        hasChanges = true;
        delete nextSelection[pageId];
      }

      return hasChanges ? nextSelection : previousSelection;
    });
  }, [optimisticallyDeletedRowPageIds]);

  const toggleSelectAllPreparedRows = (checked: boolean) => {
    if (!checked) {
      setSelectedRowPageIds({});
      return;
    }

    const nextSelection: Record<string, boolean> = {};
    for (const row of preparedRows) {
      nextSelection[row.pageId] = true;
    }
    setSelectedRowPageIds(nextSelection);
  };

  const startEditing = (row: IDatabaseRowWithCells, property: IDatabaseProperty) => {
    if (!isEditable) {
      return;
    }

    const key = `${row.pageId}:${property.id}`;
    setEditingCellKey(key);
    setEditingValue(extractCurrentDatabaseCellValue(getRawCellValue(row, property.id)));
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
    const nextCellChange = hasEffectiveCellValueChange(row, property, sourceValue);
    if (!nextCellChange) {
      setEditingCellKey(null);
      setEditingValue('');
      return;
    }

    await updateCellsMutation.mutateAsync({
      pageId: row.pageId,
      payload: {
        cells: [
          {
            propertyId: property.id,
            value: nextCellChange.shouldDelete ? null : nextCellChange.normalizedValue,
            operation: nextCellChange.shouldDelete ? 'delete' : 'upsert',
          },
        ],
      },
    });

    emitDatabaseInvalidation({
      invalidateRows: true,
      invalidateRowContext: true,
    });
    resetRowsPagination();

    setEditingCellKey(null);
    setEditingValue('');
  };

  const navigateEditingCell = (
    rowIndex: number,
    propertyIndex: number,
    direction: 'next' | 'prev' | 'down',
  ) => {
    const totalRows = preparedRows.length;
    const totalColumns = displayedProperties.length;
    if (totalRows === 0 || totalColumns === 0) {
      return null;
    }

    if (direction === 'down') {
      const nextRowIndex = rowIndex + 1;
      if (nextRowIndex >= totalRows) {
        return null;
      }

      return {
        rowIndex: nextRowIndex,
        propertyIndex,
      };
    }

    if (direction === 'next') {
      const nextPropertyIndex = propertyIndex + 1;
      if (nextPropertyIndex < totalColumns) {
        return {
          rowIndex,
          propertyIndex: nextPropertyIndex,
        };
      }

      const nextRowIndex = rowIndex + 1;
      if (nextRowIndex >= totalRows) {
        return null;
      }

      return {
        rowIndex: nextRowIndex,
        propertyIndex: 0,
      };
    }

    const previousPropertyIndex = propertyIndex - 1;
    if (previousPropertyIndex >= 0) {
      return {
        rowIndex,
        propertyIndex: previousPropertyIndex,
      };
    }

    const previousRowIndex = rowIndex - 1;
    if (previousRowIndex < 0) {
      return null;
    }

    return {
      rowIndex: previousRowIndex,
      propertyIndex: totalColumns - 1,
    };
  };

  const parseTsvMatrix = (rawText: string): string[][] => {
    return rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split('\t'));
  };

  const applyPastedMatrix = async (
    startRowIndex: number,
    startPropertyIndex: number,
    matrix: string[][],
  ) => {
    if (!isEditable || matrix.length === 0) {
      return;
    }

    const rowsPayloadByPageId = new Map<
      string,
      Array<{
        propertyId: string;
        value: unknown;
        operation: 'upsert' | 'delete';
      }>
    >();

    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
      const targetRow = preparedRows[startRowIndex + rowOffset];
      if (!targetRow) {
        break;
      }

      const values = matrix[rowOffset] ?? [];
      for (let propertyOffset = 0; propertyOffset < values.length; propertyOffset += 1) {
        const targetProperty = displayedProperties[startPropertyIndex + propertyOffset];
        if (!targetProperty) {
          break;
        }

        const rawValue = values[propertyOffset] ?? '';
        const sourceValue =
          targetProperty.type === 'checkbox' ? rawValue.trim() : rawValue;
        const nextChange = hasEffectiveCellValueChange(targetRow, targetProperty, sourceValue);
        if (!nextChange) {
          continue;
        }

        const existingPayload = rowsPayloadByPageId.get(targetRow.pageId) ?? [];
        existingPayload.push({
          propertyId: targetProperty.id,
          value: nextChange.shouldDelete ? null : nextChange.normalizedValue,
          operation: nextChange.shouldDelete ? 'delete' : 'upsert',
        });
        rowsPayloadByPageId.set(targetRow.pageId, existingPayload);
      }
    }

    if (rowsPayloadByPageId.size === 0) {
      notifications.show({
        message: t('No changes to apply'),
      });
      return;
    }

    const rowOperations = [...rowsPayloadByPageId.entries()].map(([pageId, cells]) => ({
      pageId,
      operation: 'upsert_cells' as const,
      cells,
    }));

    const chunkSize = 25;
    for (let index = 0; index < rowOperations.length; index += chunkSize) {
      const chunk = rowOperations.slice(index, index + chunkSize);
      await batchUpdateRowsMutation.mutateAsync({
        rows: chunk,
      });
    }

    emitDatabaseInvalidation({
      invalidateRows: true,
      invalidateRowContext: true,
    });
    setSelectedRowPageIds({});
    resetRowsPagination();
  };

  const updatePropertyNameDraft = (propertyId: string, value: string) => {
    setPropertyNameDrafts((prev) => ({
      ...prev,
      [propertyId]: value,
    }));
  };

  const resetPropertyNameDraft = (property: IDatabaseProperty) => {
    updatePropertyNameDraft(property.id, property.name);
  };

  const savePropertyRename = async (property: IDatabaseProperty) => {
    const draftName = propertyNameDrafts[property.id] ?? property.name;
    const nextName = resolveDatabasePropertyRename(property.name, draftName);

    if (!nextName) {
      resetPropertyNameDraft(property);
      return;
    }

    await updatePropertyMutation.mutateAsync({
      propertyId: property.id,
      payload: {
        name: nextName,
      },
    });

    emitDatabaseInvalidation({
      invalidateProperties: true,
      invalidateRows: true,
      invalidateRowContext: true,
    });
    resetRowsPagination();

    updatePropertyNameDraft(property.id, nextName);
  };

  const startRowRename = (row: IDatabaseRowWithCells) => {
    if (!isEditable) {
      return;
    }

    const currentRowTitle = getPersistedRowTitle(row);
    setRenamingRowPageId(row.pageId);
    setRenamingRowInitialTitle(currentRowTitle);
    setRenamingRowTitleDraft(currentRowTitle);
  };

  const cancelRowRename = ({
    refreshPinnedRow = true,
  }: {
    refreshPinnedRow?: boolean;
  } = {}) => {
    const shouldReleasePinnedRow =
      pinnedCreatedRow?.pageId === renamingRowPageId;

    setRenamingRowPageId(null);
    setRenamingRowInitialTitle('');
    setRenamingRowTitleDraft('');

    if (shouldReleasePinnedRow) {
      setPinnedCreatedRow(null);
      if (refreshPinnedRow) {
        resetRowsPagination();
      }
    }
  };

  const applyRowRenameToTree = (rowUpdate: {
    pageId: string;
    title: string;
    slugId: string;
  }) => {
    setTreeData((currentTreeData) => {
      const tree = new SimpleTree<SpaceTreeNode>(currentTreeData);

      if (!tree.find(rowUpdate.pageId)) {
        return currentTreeData;
      }

      tree.update({
        id: rowUpdate.pageId,
        changes: {
          name: rowUpdate.title,
          slugId: rowUpdate.slugId,
        },
      });

      return tree.data;
    });
  };

  const saveRowRename = async (row: IDatabaseRowWithCells) => {
    if (!renamingRowPageId || renamingRowPageId !== row.pageId) {
      return;
    }

    const nextTitle = renamingRowTitleDraft.trim();
    const previousTitle = renamingRowInitialTitle.trim();

    if (!nextTitle || nextTitle === previousTitle) {
      cancelRowRename();
      return;
    }

    try {
      const updatedRow = await updateRowMutation.mutateAsync({
        pageId: row.pageId,
        payload: { title: nextTitle },
      });

      applyRowRenameToTree(updatedRow);
      emit({
        operation: 'updateOne',
        spaceId,
        entity: ['pages'],
        id: updatedRow.pageId,
        payload: {
          title: updatedRow.title,
          slugId: updatedRow.slugId,
        },
      });

      emitDatabaseInvalidation({
        invalidateRows: true,
        invalidateRowContext: true,
      });
      resetRowsPagination();

      cancelRowRename({ refreshPinnedRow: false });
    } catch {
      setRenamingRowTitleDraft(previousTitle);
    }
  };

  const openRowRenameFromMenu = (row: IDatabaseRowWithCells) => {
    setTimeout(() => {
      startRowRename(row);
    }, 0);
  };

  const handleDuplicateRow = async (row: IDatabaseRowWithCells) => {
    try {
      await duplicatePage({ pageId: row.pageId });
      invalidateSidebarTree({ spaceId }, { client: queryClient });
      emitDatabaseInvalidation({
        invalidateRows: true,
        invalidateRowContext: true,
      });
      resetRowsPagination();
      notifications.show({ message: t('Page duplicated successfully') });
    } catch (err) {
      notifications.show({
        message: err.response?.data.message || 'An error occurred',
        color: 'red',
      });
    }
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
    }, {
      onSuccess: () => {
        emitDatabaseInvalidation({
          invalidateProperties: true,
          invalidateRows: true,
          invalidateRowContext: true,
        });
        resetRowsPagination();
      },
    });
    setNewPropertyName('');
    setNewPropertyType('multiline_text');
  };

  const removeRowsFromTree = (pageIds: string[]) => {
    const databaseNode = findDatabaseNodeInTree(treeData);
    if (!databaseNode) {
      return;
    }

    const rowNodesById = new Map(
      (databaseNode.children ?? []).map((childNode) => [childNode.id, childNode]),
    );

    setTreeData((currentTreeData) => {
      let nextTree = currentTreeData;
      for (const pageId of pageIds) {
        nextTree = dropTreeNode(nextTree, pageId);
      }

      const updatedDatabaseNode = findDatabaseNodeInTree(nextTree);
      if (!updatedDatabaseNode) {
        return nextTree;
      }

      return setTreeNodeHasChildren(
        nextTree,
        updatedDatabaseNode.id,
        (updatedDatabaseNode.children?.length ?? 0) > 0,
      );
    });

    for (const pageId of pageIds) {
      const rowTreeNode = rowNodesById.get(pageId);
      if (!rowTreeNode) {
        continue;
      }

      emit({
        operation: 'deleteTreeNode',
        spaceId,
        payload: {
          node: rowTreeNode,
        },
      });
    }
  };

  const hideRowsOptimistically = (rowPageIds: string[]) => {
    setOptimisticallyDeletedRowPageIds((previousIds) => {
      const nextIds = { ...previousIds };
      for (const rowPageId of rowPageIds) {
        nextIds[rowPageId] = true;
      }
      return nextIds;
    });
  };

  const restoreRowsAfterUndo = (rowPageIds: string[]) => {
    setOptimisticallyDeletedRowPageIds((previousIds) => {
      const nextIds = { ...previousIds };
      for (const rowPageId of rowPageIds) {
        delete nextIds[rowPageId];
      }
      return nextIds;
    });
  };

  const hidePropertyOptimistically = (propertyId: string) => {
    setOptimisticallyDeletedPropertyIds((previousIds) => ({
      ...previousIds,
      [propertyId]: true,
    }));
  };

  const restorePropertyAfterUndo = (propertyId: string) => {
    setOptimisticallyDeletedPropertyIds((previousIds) => {
      const nextIds = { ...previousIds };
      delete nextIds[propertyId];
      return nextIds;
    });
  };

  const executeDeleteRows = async (rowPageIds: string[]) => {
    const uniqueRowPageIds = [...new Set(rowPageIds)];
    if (uniqueRowPageIds.length === 0) {
      return;
    }

    await batchUpdateRowsMutation.mutateAsync({
      rows: uniqueRowPageIds.map((pageId) => ({
        pageId,
        operation: 'delete_row',
      })),
    });

    emitDatabaseInvalidation({
      invalidateRows: true,
      invalidateRowContext: true,
    });
    removeRowsFromTree(uniqueRowPageIds);
    setSelectedRowPageIds((previous) => {
      const next = { ...previous };
      for (const rowPageId of uniqueRowPageIds) {
        delete next[rowPageId];
      }
      return next;
    });
    restoreRowsAfterUndo(uniqueRowPageIds);
    resetRowsPagination();
  };

  const scheduleDeleteRows = (rowPageIds: string[]) => {
    const pendingRowPageIds = new Set(
      [...pendingRowDeletionsRef.current.values()].flatMap((pendingDeletion) => pendingDeletion.rowIds),
    );
    const uniqueRowPageIds = [...new Set(rowPageIds)].filter(
      (rowPageId) => !pendingRowPageIds.has(rowPageId),
    );
    if (uniqueRowPageIds.length === 0) {
      return;
    }

    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    hideRowsOptimistically(uniqueRowPageIds);
    setSelectedRowPageIds((previousSelection) => {
      const nextSelection = { ...previousSelection };
      for (const rowPageId of uniqueRowPageIds) {
        delete nextSelection[rowPageId];
      }
      return nextSelection;
    });

    const timeoutId = setTimeout(() => {
      const pendingDeletion = pendingRowDeletionsRef.current.get(token);
      if (!pendingDeletion) {
        return;
      }

      pendingRowDeletionsRef.current.delete(token);
      notifications.hide(`database-row-delete-${token}`);

      void executeDeleteRows(pendingDeletion.rowIds).catch(() => {
        restoreRowsAfterUndo(pendingDeletion.rowIds);
        notifications.show({
          color: 'red',
          message: t('Failed to delete page'),
        });
      });
    }, DELETE_GRACE_PERIOD_MS);

    pendingRowDeletionsRef.current.set(token, {
      timeoutId,
      rowIds: uniqueRowPageIds,
    });

    notifications.show({
      id: `database-row-delete-${token}`,
      autoClose: DELETE_GRACE_PERIOD_MS + 1000,
      message: (
        <Group gap="xs" wrap="nowrap">
          <Text size="sm">
            {t('Delete row')} ({uniqueRowPageIds.length})
          </Text>
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              const pendingDeletion = pendingRowDeletionsRef.current.get(token);
              if (!pendingDeletion) {
                return;
              }

              clearTimeout(pendingDeletion.timeoutId);
              pendingRowDeletionsRef.current.delete(token);
              notifications.hide(`database-row-delete-${token}`);
              restoreRowsAfterUndo(pendingDeletion.rowIds);
            }}
          >
            {t('Undo')}
          </Button>
        </Group>
      ),
    });
  };

  const confirmDeleteRows = (rowPageIds: string[]) => {
    const pendingRowPageIds = new Set(
      [...pendingRowDeletionsRef.current.values()].flatMap((pendingDeletion) => pendingDeletion.rowIds),
    );
    const uniqueRowPageIds = [...new Set(rowPageIds)].filter(
      (rowPageId) => !pendingRowPageIds.has(rowPageId),
    );
    if (uniqueRowPageIds.length === 0) {
      return;
    }

    const isMultipleRows = uniqueRowPageIds.length > 1;

    modals.openConfirmModal({
      title: t('Delete'),
      children: (
        <Text size="sm">
          {isMultipleRows
            ? t('Delete rows confirm with undo', { count: uniqueRowPageIds.length })
            : t('Delete row confirm with undo')}
        </Text>
      ),
      labels: {
        confirm: t('Delete'),
        cancel: t('Cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        scheduleDeleteRows(uniqueRowPageIds);
      },
    });
  };

  const scheduleDeleteProperty = (property: IDatabaseProperty) => {
    if (pendingPropertyDeletionsRef.current.has(property.id)) {
      return;
    }

    hidePropertyOptimistically(property.id);

    const timeoutId = setTimeout(() => {
      const scheduledTimeoutId = pendingPropertyDeletionsRef.current.get(property.id);
      if (!scheduledTimeoutId) {
        return;
      }

      pendingPropertyDeletionsRef.current.delete(property.id);
      notifications.hide(`database-property-delete-${property.id}`);

      void deletePropertyMutation.mutateAsync(property.id).then(() => {
        emitDatabaseInvalidation({
          invalidateProperties: true,
          invalidateRows: true,
          invalidateRowContext: true,
        });
        resetRowsPagination();
      }).catch(() => {
        restorePropertyAfterUndo(property.id);
        notifications.show({
          color: 'red',
          message: t('Failed to update data'),
        });
      });
    }, DELETE_GRACE_PERIOD_MS);

    pendingPropertyDeletionsRef.current.set(property.id, timeoutId);

    notifications.show({
      id: `database-property-delete-${property.id}`,
      autoClose: DELETE_GRACE_PERIOD_MS + 1000,
      message: (
        <Group gap="xs" wrap="nowrap">
          <Text size="sm">{t('Delete property with name', { name: property.name })}</Text>
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              const scheduledTimeoutId = pendingPropertyDeletionsRef.current.get(property.id);
              if (!scheduledTimeoutId) {
                return;
              }

              clearTimeout(scheduledTimeoutId);
              pendingPropertyDeletionsRef.current.delete(property.id);
              notifications.hide(`database-property-delete-${property.id}`);
              restorePropertyAfterUndo(property.id);
            }}
          >
            {t('Undo')}
          </Button>
        </Group>
      ),
    });
  };

  const confirmDeleteProperty = (property: IDatabaseProperty) => {
    modals.openConfirmModal({
      title: t('Delete'),
      children: (
        <Text size="sm">
          {t('Delete property confirm with undo and values', { name: property.name })}
        </Text>
      ),
      labels: {
        confirm: t('Delete'),
        cancel: t('Cancel'),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        scheduleDeleteProperty(property);
      },
    });
  };

  const clearFilters = () => {
    setFilters([cloneDefaultFilter()]);
  };

  const resetTableViewState = () => {
    setFilters([cloneDefaultFilter()]);
    setSortState(null);
  };

  const handleChangeSortProperty = (value: string | null) => {
    if (!value) {
      setSortState(null);
      return;
    }

    setSortState((previousSortState) => ({
      propertyId: value,
      direction: previousSortState?.direction ?? 'asc',
    }));
  };

  const handleSortDirectionChange = (value: string | null) => {
    if (!value || !sortState) {
      return;
    }

    setSortState({
      propertyId: sortState.propertyId,
      direction: value as IDatabaseRowsSortDirection,
    });
  };

  const loadMoreRows = () => {
    if (isRowsFetching || !rowsPage?.hasMore || !rowsPage.nextCursor) {
      return;
    }

    setRowsCursor(rowsPage.nextCursor);
  };

  const applyBulkUpdate = async () => {
    if (!bulkPropertyId || selectedRowIds.length === 0) {
      return;
    }

    const targetProperty = activeProperties.find((property) => property.id === bulkPropertyId);
    if (!targetProperty) {
      return;
    }

    const sourceValue =
      targetProperty.type === 'checkbox' ? bulkCheckboxValue : bulkValue;
    const rowByPageId = new Map(rows.map((row) => [row.pageId, row]));
    const rowsToUpdate: Array<{ pageId: string; shouldDelete: boolean; value: unknown }> = [];

    for (const pageId of selectedRowIds) {
      const row = rowByPageId.get(pageId);
      if (!row) {
        continue;
      }

      const nextChange = hasEffectiveCellValueChange(row, targetProperty, sourceValue);
      if (!nextChange) {
        continue;
      }

      rowsToUpdate.push({
        pageId,
        shouldDelete: nextChange.shouldDelete,
        value: nextChange.normalizedValue,
      });
    }

    if (rowsToUpdate.length === 0) {
      notifications.show({
        message: t('No changes to apply'),
      });
      return;
    }

    const chunkSize = 25;
    for (let index = 0; index < rowsToUpdate.length; index += chunkSize) {
      const rowChunk = rowsToUpdate.slice(index, index + chunkSize);
      await batchUpdateRowsMutation.mutateAsync({
        rows: rowChunk.map((row) => ({
          pageId: row.pageId,
          operation: 'upsert_cells',
          cells: [
            {
              propertyId: targetProperty.id,
              value: row.shouldDelete ? null : row.value,
              operation: row.shouldDelete ? 'delete' : 'upsert',
            },
          ],
        })),
      });
    }

    emitDatabaseInvalidation({
      invalidateRows: true,
      invalidateRowContext: true,
    });
    resetRowsPagination();
  };

  const bulkDeleteSelectedRows = () => {
    if (selectedRowIds.length === 0) {
      return;
    }

    confirmDeleteRows(selectedRowIds);
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="md" align="flex-end" wrap="wrap">
        {isEditable && (
          <Group wrap="wrap">
            <TextInput
              aria-label={t('New column name')}
              placeholder={t('New column')}
              value={newPropertyName}
              onChange={(event) => setNewPropertyName(event.currentTarget.value)}
            />
            <Select
              aria-label={t('Property type')}
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
              allowDeselect={false}
              renderOption={renderPropertyTypeOption}
              leftSection={renderPropertyTypeIcon(newPropertyType, 16)}
            />
            <Button
              leftSection={<IconPlus size={14} />}
              onClick={handleCreateProperty}
            >
              {t('Property')}
            </Button>

            <Button
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() => void handleCreateRow()}
              loading={createRowMutation.isPending}
              disabled={
                createRowMutation.isPending || Boolean(pinnedCreatedRow)
              }
            >
              {t('Row')}
            </Button>
          </Group>
        )}

        <Group wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Select
              aria-label={t('View')}
              placeholder={t('View')}
              w={200}
              data={databaseViews.map((view) => ({
                value: view.id,
                label: view.name,
              }))}
              value={selectedViewId}
              onChange={(viewId) => {
                setSelectedViewId(viewId);
                if (!viewId) {
                  setViewNameDraft('');
                }
              }}
              clearable
            />
            {isEditable && (
              <>
                <TextInput
                  aria-label={t('Name')}
                  placeholder={t('Name')}
                  w={180}
                  value={viewNameDraft}
                  onChange={(event) => setViewNameDraft(event.currentTarget.value)}
                />
                <Button
                  variant="default"
                  onClick={() => void saveCurrentView()}
                  loading={
                    createViewMutation.isPending || updateViewMutation.isPending
                  }
                  disabled={!viewNameDraft.trim()}
                >
                  {t('Save')}
                </Button>
                {selectedViewId && (
                  <AccessibleActionIcon
                    label={t('Delete')}
                    color="red"
                    variant="subtle"
                    loading={deleteViewMutation.isPending}
                    onClick={() => void deleteCurrentView()}
                  >
                    <IconTrash size={16} />
                  </AccessibleActionIcon>
                )}
              </>
            )}
          </Group>

          {isMobileViewport && (
            <Button
              variant="default"
              leftSection={<IconSettings size={14} />}
              onClick={() => setViewControlsOpened(true)}
            >
              {`${t('View')} (${activeFilterCount})`}
            </Button>
          )}

          {!isMobileViewport && (
            <>
          <Select
            aria-label={t('Sort property')}
            placeholder={t('Sort')}
            data={activeProperties.map((property) => ({
              value: property.id,
              label: property.name,
            }))}
            value={sortState?.propertyId || null}
            onChange={handleChangeSortProperty}
            clearable
          />

          <Select
            aria-label={t('Sort direction')}
            w={130}
            placeholder={t('Sort')}
            value={sortState?.direction || null}
            data={[
              { value: 'asc', label: t('Ascending') },
              { value: 'desc', label: t('Descending') },
            ]}
            onChange={handleSortDirectionChange}
            disabled={!sortState}
            allowDeselect={false}
          />

          <Menu shadow="md" width={220}>
            <Menu.Target>
              <Button variant="default" disabled={activeProperties.length === 0}>
                {t('Columns')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {activeProperties.map((property) => {
                const isVisible =
                  typeof visibleColumns[property.id] === 'boolean'
                    ? visibleColumns[property.id]
                    : true;

                return (
                  <Menu.Item
                    key={property.id}
                    leftSection={
                      isVisible ? <IconEye size={14} /> : <IconEyeOff size={14} />
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

              {isEditable && activeProperties.length > 0 && <Menu.Divider />}

              {isEditable &&
                activeProperties.map((property) => (
                  <Menu.Item
                    key={`${property.id}-delete`}
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => confirmDeleteProperty(property)}
                  >
                    {t('Delete property with name', { name: property.name })}
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
            </>
          )}
        </Group>
      </Group>

      <Drawer
        opened={viewControlsOpened}
        onClose={() => setViewControlsOpened(false)}
        title={t('View')}
        closeButtonProps={{ 'aria-label': t('Close') }}
        position="bottom"
        size="85dvh"
        styles={{
          body: {
            maxHeight: 'calc(85dvh - 60px)',
            overflowY: 'auto',
          },
        }}
      >
        <Stack>
          <Select
            aria-label={t('Sort property')}
            placeholder={t('Sort')}
            data={activeProperties.map((property) => ({
              value: property.id,
              label: property.name,
            }))}
            value={sortState?.propertyId || null}
            onChange={handleChangeSortProperty}
            clearable
          />
          <Select
            aria-label={t('Sort direction')}
            value={sortState?.direction || null}
            data={[
              { value: 'asc', label: t('Ascending') },
              { value: 'desc', label: t('Descending') },
            ]}
            onChange={handleSortDirectionChange}
            disabled={!sortState}
            allowDeselect={false}
          />
          <Menu shadow="md" width={260}>
            <Menu.Target>
              <Button variant="default" disabled={activeProperties.length === 0}>
                {t('Columns')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {activeProperties.map((property) => {
                const isVisible =
                  typeof visibleColumns[property.id] === 'boolean'
                    ? visibleColumns[property.id]
                    : true;

                return (
                  <Menu.Item
                    key={`mobile-${property.id}`}
                    leftSection={
                      isVisible ? <IconEye size={14} /> : <IconEyeOff size={14} />
                    }
                    onClick={() =>
                      setVisibleColumns((previousColumns) => ({
                        ...previousColumns,
                        [property.id]: !isVisible,
                      }))
                    }
                  >
                    {property.name}
                  </Menu.Item>
                );
              })}
            </Menu.Dropdown>
          </Menu>
          <DatabaseFilterEditor
            filters={filters}
            properties={activeProperties}
            checkboxOptions={checkboxFilterOptions}
            maxFilters={MAX_FILTERS}
            layout="stacked"
            createFilter={cloneDefaultFilter}
            onChange={setFilters}
            onClear={clearFilters}
            onReset={resetTableViewState}
          />
        </Stack>
      </Drawer>

      {isDatabaseFilterControlsVisible(isMobileViewport) && (
        <DatabaseFilterEditor
          filters={filters}
          properties={activeProperties}
          checkboxOptions={checkboxFilterOptions}
          maxFilters={MAX_FILTERS}
          layout="inline"
          createFilter={cloneDefaultFilter}
          onChange={setFilters}
          onClear={clearFilters}
          onReset={resetTableViewState}
        />

      )}



      {isEditable && selectedRowIds.length > 0 && (
        <Paper withBorder radius="sm" p="sm" mb="md">
          <Group wrap="wrap">
            <Text size="sm">
              {t('Rows')}: {selectedRowIds.length}
            </Text>
            <Select
              aria-label={t('Bulk update property')}
              w={220}
              placeholder={t('Property')}
              data={displayedProperties.map((property) => ({
                value: property.id,
                label: property.name,
              }))}
              value={bulkPropertyId}
              onChange={(value) => setBulkPropertyId(value)}
            />
            {activeProperties.find((property) => property.id === bulkPropertyId)?.type === 'checkbox' ? (
              <Select
                aria-label={t('Bulk checkbox value')}
                w={140}
                value={bulkCheckboxValue}
                data={checkboxFilterOptions}
                onChange={(value) =>
                  setBulkCheckboxValue((value as 'true' | 'false') || 'true')
                }
                allowDeselect={false}
              />
            ) : (
              <TextInput
                aria-label={t('Bulk update value')}
                placeholder={t('Value')}
                value={bulkValue}
                onChange={(event) => setBulkValue(event.currentTarget.value)}
              />
            )}
            <Button onClick={() => void applyBulkUpdate()}>
              {t('Update')}
            </Button>
            <Button color="red" variant="light" onClick={bulkDeleteSelectedRows}>
              {t('Delete')}
            </Button>
            <Button
              variant="subtle"
              onClick={() => setSelectedRowPageIds({})}
            >
              {t('Cancel')}
            </Button>
          </Group>
        </Paper>
      )}

      <DictionaryHighlightLayer
        terms={activeDictionaryTerms}
        spaceId={spaceId}
        canCreate={dictionaryEnabled && canManageDictionary}
        enableSelectionCreate
      >
        {isMobileViewport && (
          <Text className={classes.scrollHint}>
            {t('Scroll horizontally to see all columns')}
          </Text>
        )}
        <ScrollArea
          viewportRef={tableViewportRef}
          mah={isMobileViewport ? 520 : 620}
          onScrollPositionChange={(position) => setTableScrollTop(position.y)}
          className={classes.databaseScroll}
        >
          <Table
            stickyHeader
            withTableBorder
            withColumnBorders
            miw={isMobileViewport ? 760 : 900}
            layout="auto"
            className={classes.databaseTable}
            style={
              {
                '--database-title-column-left': isEditable ? '52px' : '0px',
              } as CSSProperties
            }
          >
          <Table.Thead>
            <Table.Tr>
              {isEditable && (
                <Table.Th w={52} className={classes.selectColumn}>
                  <Checkbox
                    aria-label={t('Select all rows')}
                    checked={preparedRows.length > 0 && selectedRowIds.length === preparedRows.length}
                    indeterminate={
                      selectedRowIds.length > 0 && selectedRowIds.length < preparedRows.length
                    }
                    onChange={(event) => toggleSelectAllPreparedRows(event.currentTarget.checked)}
                  />
                </Table.Th>
              )}
              <Table.Th
                miw={isMobileViewport ? 220 : 280}
                className={classes.titleColumn}
              >
                {t('Title')}
              </Table.Th>
              {displayedProperties.map((property, propertyIndex) => (
                <Table.Th
                  key={property.id}
                  miw={220}
                  className={classes.propertyHeader}
                  data-database-property-id={property.id}
                  data-dragging={draggedPropertyId === property.id}
                  data-drop-target={
                    Boolean(draggedPropertyId) &&
                    dragOverPropertyId === property.id &&
                    draggedPropertyId !== property.id
                  }
                  onDragOver={(event) => {
                    const movedPropertyId = draggedPropertyIdRef.current;
                    if (
                      !isEditable ||
                      !movedPropertyId ||
                      movedPropertyId === property.id
                    ) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverPropertyId(property.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const movedPropertyId = resolveDraggedDatabasePropertyId(
                      draggedPropertyIdRef.current,
                      event.dataTransfer,
                    );

                    clearPropertyDragState();

                    if (movedPropertyId && movedPropertyId !== property.id) {
                      void moveProperty(movedPropertyId, property.id);
                    }
                  }}
                >
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    {isEditable ? (
                      <>
                        <AccessibleActionIcon
                          className={classes.propertyDragHandle}
                          variant="subtle"
                          label={t('Move')}
                          tooltip={false}
                          draggable
                          disabled={updatePropertyMutation.isPending}
                          style={{ touchAction: 'none' }}
                          onPointerDown={(event) => {
                            if (event.pointerType === 'mouse') {
                              return;
                            }

                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            draggedPropertyIdRef.current = property.id;
                            setDraggedPropertyId(property.id);
                            setDragOverPropertyId(null);
                          }}
                          onPointerMove={(event) => {
                            const movedPropertyId = draggedPropertyIdRef.current;
                            if (event.pointerType === 'mouse' || !movedPropertyId) {
                              return;
                            }

                            event.preventDefault();
                            const targetPropertyId = getPropertyIdAtPoint(
                              event.clientX,
                              event.clientY,
                            );
                            setDragOverPropertyId(
                              targetPropertyId && targetPropertyId !== movedPropertyId
                                ? targetPropertyId
                                : null,
                            );
                          }}
                          onPointerUp={(event) => {
                            if (event.pointerType === 'mouse') {
                              return;
                            }

                            const movedPropertyId = draggedPropertyIdRef.current;
                            const targetPropertyId = getPropertyIdAtPoint(
                              event.clientX,
                              event.clientY,
                            );
                            clearPropertyDragState();

                            if (
                              movedPropertyId &&
                              targetPropertyId &&
                              movedPropertyId !== targetPropertyId
                            ) {
                              void moveProperty(movedPropertyId, targetPropertyId);
                            }
                          }}
                          onPointerCancel={clearPropertyDragState}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(
                              DATABASE_PROPERTY_DRAG_MIME,
                              property.id,
                            );
                            event.dataTransfer.setData('text/plain', property.id);
                            draggedPropertyIdRef.current = property.id;
                            setDraggedPropertyId(property.id);
                            setDragOverPropertyId(null);
                          }}
                          onDragEnd={clearPropertyDragState}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowLeft') {
                              event.preventDefault();
                              movePropertyByVisibleOffset(property.id, -1);
                            }

                            if (event.key === 'ArrowRight') {
                              event.preventDefault();
                              movePropertyByVisibleOffset(property.id, 1);
                            }
                          }}
                        >
                          <IconGripVertical size={14} />
                        </AccessibleActionIcon>
                        <div className={classes.propertyName}>
                          <TextInput
                            aria-label={t('Property name')}
                            value={
                              propertyNameDrafts[property.id] ?? property.name
                            }
                            my={4}
                            onChange={(event) =>
                              updatePropertyNameDraft(
                                property.id,
                                event.currentTarget.value,
                              )
                            }
                            onBlur={() => void savePropertyRename(property)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }

                              if (event.key === 'Escape') {
                                event.preventDefault();
                                resetPropertyNameDraft(property);
                              }
                            }}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                          />
                        </div>
                      </>
                    ) : (
                      <Text size="sm" fw="bold">
                        {property.name}
                      </Text>
                    )}
                    {isEditable && (
                      <Menu position="bottom-end" shadow="md" withinPortal>
                        <Menu.Target>
                          <AccessibleActionIcon
                            variant="subtle"
                            label={t('Property actions')}
                            tooltip={false}
                          >
                            <IconDotsVertical size={14} />
                          </AccessibleActionIcon>
                        </Menu.Target>

                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconArrowLeft size={14} />}
                            disabled={
                              propertyIndex === 0 ||
                              updatePropertyMutation.isPending
                            }
                            onClick={() =>
                              movePropertyByVisibleOffset(property.id, -1)
                            }
                          >
                            {`${t('Move')} ←`}
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconArrowRight size={14} />}
                            disabled={
                              propertyIndex ===
                                displayedProperties.length - 1 ||
                              updatePropertyMutation.isPending
                            }
                            onClick={() =>
                              movePropertyByVisibleOffset(property.id, 1)
                            }
                          >
                            {`${t('Move')} →`}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Sub>
                            <Menu.Sub.Target>
                              <Menu.Sub.Item
                                leftSection={
                                  <IconSwitchHorizontal size={14} />
                                }
                              >
                                {t('Type')}
                              </Menu.Sub.Item>
                            </Menu.Sub.Target>
                            <Menu.Sub.Dropdown>
                              {DATABASE_PROPERTY_TYPES.map((propertyType) => (
                                <Menu.Item
                                  key={`${property.id}-${propertyType}`}
                                  leftSection={renderPropertyTypeIcon(
                                    propertyType,
                                    14,
                                  )}
                                  disabled={propertyType === property.type}
                                  onClick={() =>
                                    updatePropertyMutation.mutate(
                                      {
                                        propertyId: property.id,
                                        payload: { type: propertyType },
                                      },
                                      {
                                        onSuccess: () => {
                                          emitDatabaseInvalidation({
                                            invalidateProperties: true,
                                            invalidateRows: true,
                                            invalidateRowContext: true,
                                          });
                                          resetRowsPagination();
                                        },
                                      },
                                    )
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
                            onClick={() => confirmDeleteProperty(property)}
                          >
                            {t('Delete property with name', {
                              name: property.name,
                            })}
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
            {virtualizedRows.topOffset > 0 && (
              <Table.Tr aria-hidden>
                <Table.Td
                  colSpan={displayedProperties.length + (isEditable ? 2 : 1)}
                  p={0}
                  style={{ height: virtualizedRows.topOffset }}
                />
              </Table.Tr>
            )}
            {virtualizedRows.rows.map((row, virtualRowIndex) => {
              const rowIndex = virtualizedRows.startIndex + virtualRowIndex;
              return (
              <Table.Tr key={row.id}>
                {isEditable && (
                  <Table.Td className={classes.selectColumn}>
                    <Checkbox
                      aria-label={t('Select row')}
                      checked={Boolean(selectedRowPageIds[row.pageId])}
                      onChange={(event) =>
                        setSelectedRowPageIds((previousSelection) => ({
                          ...previousSelection,
                          [row.pageId]: event.currentTarget.checked,
                        }))
                      }
                    />
                  </Table.Td>
                )}
                <Table.Td className={classes.titleColumn}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <div>
                      {renamingRowPageId === row.pageId ? (
                        <TextInput
                          aria-label={t('Row title')}
                          autoFocus
                          value={renamingRowTitleDraft}
                          onChange={(event) => setRenamingRowTitleDraft(event.currentTarget.value)}
                          onBlur={() => void saveRowRename(row)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }

                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRowRename();
                            }
                          }}
                        />
                      ) : (
                        <Text component={Link} to={`/s/${spaceSlug}/p/${row.page?.slugId ?? row.pageId}`}>
                          {getRowTitle(row, t('untitled'))}
                        </Text>
                      )}
                    </div>

                    <Menu
                      position="bottom-end"
                      shadow="md"
                      withinPortal
                      returnFocus={false}
                    >
                      <Menu.Target>
                        <AccessibleActionIcon
                          variant="subtle"
                          label={t('Row actions')}
                          tooltip={false}
                        >
                          <IconDotsVertical size={14} />
                        </AccessibleActionIcon>
                      </Menu.Target>

                      <Menu.Dropdown>
                        {isEditable && (
                          <Menu.Item
                            leftSection={<IconPencil size={14} />}
                            onClick={() => openRowRenameFromMenu(row)}
                          >
                            {t('Rename row')}
                          </Menu.Item>
                        )}

                        {isEditable && (
                          <PageOperationMenuItems
                            onDuplicate={() => void handleDuplicateRow(row)}
                            onMove={() => setMovingRow(row)}
                            onCopyToSpace={() => setCopyingRow(row)}
                          />
                        )}

                        <Menu.Item
                          leftSection={<IconMessageCircle size={14} />}
                          onClick={() =>
                            navigate(`/s/${spaceSlug}/p/${row.page?.slugId ?? row.pageId}`, {
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
                            onClick={() => confirmDeleteRows([row.pageId])}
                          >
                            {t('Delete row')}
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Table.Td>

                {displayedProperties.map((property, propertyIndex) => {
                  const key = `${row.pageId}:${property.id}`;
                  const isEditing = editingCellKey === key;

                  return (
                    <Table.Td
                      key={property.id}
                      data-database-cell-key={key}
                      tabIndex={0}
                      aria-label={`${property.name}: ${getRowTitle(row, t('untitled'))}`}
                      className={classes.editableCell}
                      onKeyDown={(event) => {
                        if (!isEditing) {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === 'Enter' || event.key === 'F2')
                          ) {
                            event.preventDefault();
                            startEditing(row, property);
                          }
                          return;
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingCellKey(null);
                          setEditingValue('');
                          return;
                        }

                        const canHandleEnter =
                          event.key === 'Enter' &&
                          property.type !== 'multiline_text' &&
                          property.type !== 'code';
                        const canHandleTab = event.key === 'Tab';
                        if (!canHandleEnter && !canHandleTab) {
                          return;
                        }

                        event.preventDefault();
                        void (async () => {
                          await saveEditing(row, property);
                          const nextCell = navigateEditingCell(
                            rowIndex,
                            propertyIndex,
                            canHandleTab
                              ? event.shiftKey ? 'prev' : 'next'
                              : 'down',
                          );
                          if (!nextCell) {
                            return;
                          }

                          const nextRow = preparedRows[nextCell.rowIndex];
                          const nextProperty = displayedProperties[nextCell.propertyIndex];
                          if (!nextRow || !nextProperty) {
                            return;
                          }

                          startEditing(nextRow, nextProperty);
                        })();
                      }}
                      onPaste={(event) => {
                        if (!isEditable) {
                          return;
                        }

                        const pastedText = event.clipboardData.getData('text');
                        if (
                          !shouldHandleDatabaseMatrixPaste(
                            pastedText,
                            isEditing,
                            property.type,
                          )
                        ) {
                          return;
                        }

                        event.preventDefault();
                        const matrix = parseTsvMatrix(pastedText);
                        void applyPastedMatrix(rowIndex, propertyIndex, matrix);
                      }}
                    >
                      <DatabaseCellRenderer
                        property={property}
                        value={getRawCellValue(row, property.id)}
                        isEditable={isEditable}
                        isEditing={isEditing}
                        editingValue={editingValue}
                        spaceId={spaceId}
                        dictionaryTerms={activeDictionaryTerms}
                        dictionaryMatcherIndex={dictionaryMatcherIndex}
                        dictionaryEnabled={dictionaryEnabled}
                        canManageDictionary={canManageDictionary}
                        pageOptions={pageReferenceOptions}
                        pageReferenceUrlById={pageReferenceUrlById}
                        isPageOptionsLoading={allPagesQuery.isLoading}
                        cellLabel={`${property.name}: ${getRowTitle(row, t('untitled'))}`}
                        onStartEdit={() => startEditing(row, property)}
                        onChange={setEditingValue}
                        onSave={(nextValue) => saveEditing(row, property, nextValue)}
                      />
                    </Table.Td>
                  );
                })}

              </Table.Tr>
              );
            })}
            {virtualizedRows.bottomOffset > 0 && (
              <Table.Tr aria-hidden>
                <Table.Td
                  colSpan={displayedProperties.length + (isEditable ? 2 : 1)}
                  p={0}
                  style={{ height: virtualizedRows.bottomOffset }}
                />
              </Table.Tr>
            )}
          </Table.Tbody>
          </Table>
        </ScrollArea>
      </DictionaryHighlightLayer>
      {rowsPage?.hasMore && (
        <Group justify="center" mt="md">
          <Button
            variant="default"
            onClick={loadMoreRows}
            disabled={isRowsFetching}
          >
            {isRowsFetching ? t('Loading...') : t('Load more')}
          </Button>
        </Group>
      )}
      <SelectPropertySettingsModal
        opened={Boolean(settingsProperty || selectPropertyDraft)}
        propertyName={settingsProperty?.name || selectPropertyDraft?.name || ''}
        initialSettings={
          settingsProperty
            ? getDatabaseSelectSettings(settingsProperty)
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
            emitDatabaseInvalidation({
              invalidateProperties: true,
              invalidateRows: true,
              invalidateRowContext: true,
            });
            resetRowsPagination();
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
          emitDatabaseInvalidation({
            invalidateProperties: true,
            invalidateRows: true,
            invalidateRowContext: true,
          });
          resetRowsPagination();
          setNewPropertyName('');
          setNewPropertyType('multiline_text');
        }}
      />
      {movingRow && (
        <MovePageModal
          pageId={movingRow.pageId}
          slugId={movingRow.page?.slugId ?? movingRow.pageId}
          currentSpaceSlug={spaceSlug}
          nodeType="databaseRow"
          title={getRowTitle(movingRow, t('untitled'))}
          open
          onClose={() => {
            setMovingRow(null);
            emitDatabaseInvalidation({
              invalidateRows: true,
              invalidateRowContext: true,
            });
            resetRowsPagination();
          }}
        />
      )}
      {copyingRow && (
        <CopyPageModal
          pageId={copyingRow.pageId}
          currentSpaceSlug={spaceSlug}
          nodeType="databaseRow"
          open
          onClose={() => setCopyingRow(null)}
        />
      )}
    </Paper>
  );
}
