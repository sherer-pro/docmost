import {
  IDatabaseFilterCondition,
  IDatabaseRowWithCells,
  IDatabaseSortState,
} from '@/features/database/types/database-table.types';
import { IDatabaseProperty } from '@/features/database/types/database.types';

export interface IDatabaseTableExportState {
  visibleColumns: Record<string, boolean>;
  filters: IDatabaseFilterCondition[];
  sortState: IDatabaseSortState | null;
}

/**
 * Safely converts an arbitrary cell value into a string for a markdown table.
 */
export function stringifyCellValue(value: unknown): string {
  const normalizedValue = extractCurrentCellValue(value);

  if (normalizedValue === null || typeof normalizedValue === 'undefined') {
    return '';
  }

  if (typeof normalizedValue === 'string') {
    return normalizedValue;
  }

  return JSON.stringify(normalizedValue);
}

/**
 * Returns the current value of a cell from the fallback container after changing the type.
 */
function extractCurrentCellValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  if (!('value' in candidate) || !('rawValueBeforeTypeChange' in candidate)) {
    return value;
  }

  return candidate.value;
}

/**
 * Escapes special characters from a markdown table so as not to break the column structure.
 */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Returns the title of a database row from fallback to the localized "Untitled".
 */
export function getRowTitle(row: IDatabaseRowWithCells, untitledLabel: string): string {
  return row.page?.title || row.pageTitle || untitledLabel;
}

/**
 * Gets the text value of a cell by propertyId.
 */
export function getCellValue(row: IDatabaseRowWithCells, propertyId: string): string {
  const value = row.cells?.find((cell) => cell.propertyId === propertyId)?.value;
  return stringifyCellValue(value);
}

/**
 * Checks whether the cell value passes the filter condition.
 */
export function matchCondition(value: string, condition: IDatabaseFilterCondition): boolean {
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
 * Applies exactly the same filtering/sorting/visibility rules to rows,
 * as in the interactive table on the screen.
 */
export function prepareDatabaseRowsForExport(
  rows: IDatabaseRowWithCells[],
  state: IDatabaseTableExportState,
): IDatabaseRowWithCells[] {
  const activeFilters = state.filters.filter((condition) => condition.propertyId && condition.value);

  const filteredRows = rows.filter((row) =>
    activeFilters.every((condition) => {
      const value = getCellValue(row, condition.propertyId);
      return matchCondition(value, condition);
    }),
  );

  if (!state.sortState) {
    return filteredRows;
  }

  return [...filteredRows].sort((left, right) => {
    const leftValue = getCellValue(left, state.sortState.propertyId);
    const rightValue = getCellValue(right, state.sortState.propertyId);
    const result = leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: 'base',
    });

    return state.sortState.direction === 'asc' ? result : -result;
  });
}

/**
 * Builds database markdown: title, description and table in the current UI state.
 */
export function buildDatabaseMarkdownFromState(params: {
  title: string;
  description?: string | null;
  properties: IDatabaseProperty[];
  rows: IDatabaseRowWithCells[];
  state: IDatabaseTableExportState;
  untitledLabel: string;
}): string {
  const { title, description, properties, rows, state, untitledLabel } = params;

  const displayedProperties = properties.filter((property) => {
    const explicitValue = state.visibleColumns[property.id];
    return typeof explicitValue === 'boolean' ? explicitValue : true;
  });

  const preparedRows = prepareDatabaseRowsForExport(rows, state);

  const header = ['Title', ...displayedProperties.map((property) => property.name || 'Column')];
  const separator = header.map(() => '---');

  const tableRows = preparedRows.map((row) => [
    escapeMarkdownCell(getRowTitle(row, untitledLabel)),
    ...displayedProperties.map((property) =>
      escapeMarkdownCell(getCellValue(row, property.id)),
    ),
  ]);

  const table = [header, separator, ...tableRows]
    .map((line) => `| ${line.join(' | ')} |`)
    .join('\n');

  const normalizedDescription = description?.trim();
  const descriptionBlock = normalizedDescription ? `${normalizedDescription}\n\n` : '';

  return `# ${title}\n\n${descriptionBlock}${table}`;
}
