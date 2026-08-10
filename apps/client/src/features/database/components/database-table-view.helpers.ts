import { DatabasePropertyType } from '@docmost/api-contract';
import type {
  IDatabaseFilterCondition,
  IDatabaseRowWithCells,
  IDatabaseSortState,
} from '@/features/database/types/database-table.types';
import type { IDatabaseViewConfig } from '@/features/database/types/database.types';

export const DATABASE_PROPERTY_DRAG_MIME =
  'application/x-docmost-database-property';

export const resolveDraggedDatabasePropertyId = (
  activePropertyId: string | null,
  dataTransfer: Pick<DataTransfer, 'getData'>,
): string | null =>
  activePropertyId ||
  dataTransfer.getData(DATABASE_PROPERTY_DRAG_MIME) ||
  dataTransfer.getData('text/plain') ||
  null;

const hasEmptyUserReference = (value: unknown): boolean => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    !(value as { id?: string }).id
  );
};

export const shouldDeleteCellPayload = (
  propertyType: DatabasePropertyType,
  normalizedValue: unknown,
): boolean => {
  return (
    propertyType !== 'checkbox' &&
    (normalizedValue === null || normalizedValue === '' || hasEmptyUserReference(normalizedValue))
  );
};

export const isSameCellPayloadValue = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }

  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

export const isDatabaseFilterControlsVisible = (isMobileViewport: boolean): boolean => {
  return !isMobileViewport;
};

export const shouldShowDatabaseFilterRemove = (filterCount: number): boolean => {
  return filterCount > 1;
};

export const shouldHandleDatabaseMatrixPaste = (
  pastedText: string,
  isEditing: boolean,
  propertyType: DatabasePropertyType,
): boolean => {
  if (!pastedText.includes('\n') && !pastedText.includes('\t')) {
    return false;
  }

  return !(
    isEditing &&
    (propertyType === 'multiline_text' || propertyType === 'code')
  );
};

export const mergePinnedDatabaseRow = (
  rows: IDatabaseRowWithCells[],
  pinnedRow: IDatabaseRowWithCells | null,
): IDatabaseRowWithCells[] => {
  if (!pinnedRow) {
    return rows;
  }

  return [pinnedRow, ...rows.filter((row) => row.pageId !== pinnedRow.pageId)];
};

export const reorderDatabaseProperties = <T extends { id: string; position: number }>(
  properties: T[],
  movedPropertyId: string,
  targetPropertyId: string,
): T[] => {
  const currentIndex = properties.findIndex((property) => property.id === movedPropertyId);
  const targetIndex = properties.findIndex((property) => property.id === targetPropertyId);

  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
    return properties;
  }

  const reorderedProperties = [...properties];
  const movedProperty = reorderedProperties[currentIndex];
  if (!movedProperty) {
    return properties;
  }

  reorderedProperties.splice(currentIndex, 1);
  reorderedProperties.splice(targetIndex, 0, movedProperty);

  return reorderedProperties.map((property, position) =>
    property.position === position ? property : { ...property, position },
  );
};

export const getCheckboxFilterOptions = (
  t: (key: string) => string,
): Array<{ value: 'true' | 'false'; label: string }> => {
  return [
    { value: 'true', label: t('Checked') },
    { value: 'false', label: t('Unchecked') },
  ];
};

export const getSelectedPreparedRowIds = (
  selectedRowPageIds: Record<string, boolean>,
  preparedRows: Array<{ pageId: string }>,
): string[] => {
  const preparedRowPageIds = new Set(preparedRows.map((row) => row.pageId));

  return Object.entries(selectedRowPageIds)
    .filter(([pageId, isSelected]) => isSelected && preparedRowPageIds.has(pageId))
    .map(([pageId]) => pageId);
};

export const resolveDatabasePropertyRename = (
  currentName: string,
  draftName: string,
): string | null => {
  const nextName = draftName.trim();
  if (!nextName || nextName === currentName) {
    return null;
  }

  return nextName;
};

export const normalizeDatabaseViewConfig = (
  config: IDatabaseViewConfig | null,
  propertyIds: string[],
): {
  filters: IDatabaseFilterCondition[];
  sortState: IDatabaseSortState | null;
  visibleColumns: Record<string, boolean>;
} => {
  const activePropertyIds = new Set(propertyIds);
  const filters = Array.isArray(config?.filters)
    ? config.filters
        .filter(
          (filter): filter is IDatabaseFilterCondition =>
            Boolean(filter) &&
            activePropertyIds.has(filter.propertyId) &&
            (filter.operator === 'contains' ||
              filter.operator === 'equals' ||
              filter.operator === 'not_equals') &&
            typeof filter.value === 'string',
        )
        .slice(0, 10)
    : [];
  const sortState =
    config?.sortState &&
    activePropertyIds.has(config.sortState.propertyId) &&
    (config.sortState.direction === 'asc' || config.sortState.direction === 'desc')
      ? config.sortState
      : null;
  const visibleColumns = Object.fromEntries(
    Object.entries(config?.visibleColumns ?? {}).filter(
      ([propertyId, isVisible]) =>
        activePropertyIds.has(propertyId) && typeof isVisible === 'boolean',
    ),
  );

  return { filters, sortState, visibleColumns };
};
