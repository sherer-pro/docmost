import {
  IDatabaseFilterCondition,
  IDatabaseRowWithCells,
  IDatabaseSortState,
} from '@/features/database/types/database-table.types';
import { IDatabaseProperty } from '@/features/database/types/database.types';
import { extractCurrentDatabaseCellValue, getDatabaseCellDisplayValue } from '@/features/database/utils/database-cell-value';

export interface IDatabaseTableExportState {
  visibleColumns: Record<string, boolean>;
  filters: IDatabaseFilterCondition[];
  sortState: IDatabaseSortState | null;
}

interface ICellValueContext {
  propertiesById?: Record<string, IDatabaseProperty>;
  pageTitleById?: Record<string, string>;
}

/**
 * Safely converts an arbitrary cell value into a string for a markdown table.
 */
export function stringifyCellValue(value: unknown): string {
  const normalizedValue = extractCurrentDatabaseCellValue(value);

  if (normalizedValue === null || typeof normalizedValue === 'undefined') {
    return '';
  }

  if (typeof normalizedValue === 'string') {
    return normalizedValue;
  }

  return JSON.stringify(normalizedValue);
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
export function getCellValue(
  row: IDatabaseRowWithCells,
  propertyId: string,
  context?: ICellValueContext,
): string {
  const value = row.cells?.find((cell) => cell.propertyId === propertyId)?.value;
  const normalizedValue = getDatabaseCellDisplayValue({
    value,
    property: context?.propertiesById?.[propertyId],
    pageTitleById: context?.pageTitleById,
  });

  return stringifyCellValue(normalizedValue);
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
  context?: ICellValueContext,
): IDatabaseRowWithCells[] {
  const activeFilters = state.filters.filter((condition) => condition.propertyId && condition.value);

  const filteredRows = rows.filter((row) =>
    activeFilters.every((condition) => {
      const value = getCellValue(row, condition.propertyId, context);
      return matchCondition(value, condition);
    }),
  );

  if (!state.sortState) {
    return filteredRows;
  }

  return [...filteredRows].sort((left, right) => {
    const leftValue = getCellValue(left, state.sortState.propertyId, context);
    const rightValue = getCellValue(right, state.sortState.propertyId, context);
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
  pageTitleById?: Record<string, string>;
}): string {
  const { title, description, properties, rows, state, untitledLabel, pageTitleById } = params;

  const propertiesById = Object.fromEntries(properties.map((property) => [property.id, property]));
  const rowPageTitleById = Object.fromEntries(
    rows
      .map((row) => [row.pageId, getRowTitle(row, untitledLabel)] as const)
      .filter(([, rowTitle]) => Boolean(rowTitle)),
  );
  const cellValueContext: ICellValueContext = {
    propertiesById,
    pageTitleById: {
      ...rowPageTitleById,
      ...pageTitleById,
    },
  };

  const displayedProperties = properties.filter((property) => {
    const explicitValue = state.visibleColumns[property.id];
    return typeof explicitValue === 'boolean' ? explicitValue : true;
  });

  const preparedRows = prepareDatabaseRowsForExport(rows, state, cellValueContext);

  const header = ['Title', ...displayedProperties.map((property) => property.name || 'Column')];
  const separator = header.map(() => '---');

  const tableRows = preparedRows.map((row) => [
    escapeMarkdownCell(getRowTitle(row, untitledLabel)),
    ...displayedProperties.map((property) =>
      escapeMarkdownCell(getCellValue(row, property.id, cellValueContext)),
    ),
  ]);

  const table = [header, separator, ...tableRows]
    .map((line) => `| ${line.join(' | ')} |`)
    .join('\n');

  const normalizedDescription = description?.trim();
  const descriptionBlock = normalizedDescription ? `${normalizedDescription}\n\n` : '';

  return `# ${title}\n\n${descriptionBlock}${table}`;
}
