/**
 * Short page info related to a database row.
 */
export interface IDatabaseRowPage {
  id: string;
  slugId?: string;
  title: string | null;
  icon?: string | null;
  parentPageId?: string | null;
  position?: string | null;
  /**
   * Custom page document fields.
   *
   * Source: page.settings on the backend (similar to the page API),
   * while assignee/stakeholders may be omitted from the response
   * if corresponding fields are disabled in space settings.
   */
  customFields?: {
    status?: string | null;
    assigneeId?: string | null;
    stakeholderIds?: string[];
  };
}

/**
 * Value of a specific cell (pageId + propertyId pair).
 */
export interface IDatabaseCellValue {
  id: string;
  pageId: string;
  propertyId: string;
  value: unknown;
}

/**
 * Extended row model for the table view.
 *
 * The backend may return only base row fields,
 * so some fields are optional and are carefully
 * handled on the client.
 */
export interface IDatabaseRowWithCells {
  id: string;
  pageId: string;
  page?: IDatabaseRowPage;
  pageTitle?: string;
  cells?: IDatabaseCellValue[];
}

/**
 * Single filter state in the UI (limited to 1-3 conditions).
 */
export interface IDatabaseFilterCondition {
  propertyId: string;
  operator: 'contains' | 'equals' | 'not_equals';
  value: string;
}

/**
 * Single-field sorting state.
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
