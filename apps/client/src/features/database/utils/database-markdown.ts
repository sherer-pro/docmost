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
 * Безопасно преобразует произвольное значение ячейки в строку для markdown-таблицы.
 */
export function stringifyCellValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

/**
 * Экранирует спецсимволы markdown-таблицы, чтобы не ломать структуру колонок.
 */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Возвращает заголовок строки базы данных с fallback на локализованный "Untitled".
 */
export function getRowTitle(row: IDatabaseRowWithCells, untitledLabel: string): string {
  return row.page?.title || row.pageTitle || untitledLabel;
}

/**
 * Получает текстовое значение ячейки по propertyId.
 */
export function getCellValue(row: IDatabaseRowWithCells, propertyId: string): string {
  const value = row.cells?.find((cell) => cell.propertyId === propertyId)?.value;
  return stringifyCellValue(value);
}

/**
 * Проверяет, проходит ли значение ячейки условие фильтра.
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
 * Применяет к строкам ровно те же правила фильтрации/сортировки/видимости,
 * что и в интерактивной таблице на экране.
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
 * Строит markdown базы данных: заголовок, описание и таблицу в текущем UI-состоянии.
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
