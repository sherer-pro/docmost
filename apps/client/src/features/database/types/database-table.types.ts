/**
 * Краткая информация о странице, связанной со строкой базы данных.
 */
export interface IDatabaseRowPage {
  id: string;
  slugId?: string;
  title: string | null;
  icon?: string | null;
  parentPageId?: string | null;
}

/**
 * Значение конкретной ячейки (связка pageId + propertyId).
 */
export interface IDatabaseCellValue {
  id: string;
  pageId: string;
  propertyId: string;
  value: unknown;
}

/**
 * Расширенная модель строки для table view.
 *
 * Backend может возвращать только базовые поля строки,
 * поэтому часть полей сделана опциональной и аккуратно
 * обрабатывается на клиенте.
 */
export interface IDatabaseRowWithCells {
  id: string;
  pageId: string;
  page?: IDatabaseRowPage;
  pageTitle?: string;
  cells?: IDatabaseCellValue[];
}

/**
 * Состояние одной фильтрации в UI (ограничено 1-3 условиями).
 */
export interface IDatabaseFilterCondition {
  propertyId: string;
  operator: 'contains' | 'equals' | 'not_equals';
  value: string;
}

/**
 * Состояние сортировки по одному полю.
 */
export interface IDatabaseSortState {
  propertyId: string;
  direction: 'asc' | 'desc';
}


export interface IDatabaseRowContext {
  database: {
    id: string;
    name: string;
  };
  row: {
    pageId: string;
    databaseId: string;
  };
  properties: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  cells: IDatabaseCellValue[];
}
