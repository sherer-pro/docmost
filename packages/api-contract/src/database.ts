import type { DatabasePropertyType } from "./database-property-type";

export enum DatabaseExportFormat {
  Docmost = "docmost",
  Markdown = "markdown",
  HTML = "html",
  PDF = "pdf",
}

export interface DatabaseSelectOption {
  label: string;
  value: string;
  color?: string;
}

export interface DatabaseSelectPropertySettings {
  options: DatabaseSelectOption[];
}

export type DatabasePropertySettings =
  | DatabaseSelectPropertySettings
  | DatabaseNumberPropertySettings
  | Record<string, never>;

export interface DatabaseNumberPropertySettings {
  format: "number" | "percent" | "currency";
  currency?: string;
  precision?: number;
}

export interface DatabaseDateValue {
  start: string;
  end?: string;
  timeZone?: string;
}

export type DatabaseFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between";
export interface DatabaseFilterRule {
  propertyId: string;
  operator: DatabaseFilterOperator;
  value?: unknown;
}
export interface DatabaseFilterGroup {
  conjunction: "and" | "or";
  conditions: Array<DatabaseFilterRule | DatabaseFilterGroup>;
}
export interface DatabaseSort {
  propertyId: string;
  direction: "asc" | "desc";
}
export type DatabaseCalculation =
  | "count"
  | "filled"
  | "empty"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "earliest"
  | "latest";
export interface DatabaseViewState {
  version: 2;
  filter?: DatabaseFilterGroup;
  sorts: DatabaseSort[];
  groupBy?: string | null;
  visibleColumns: Record<string, boolean>;
  calculations: Record<string, DatabaseCalculation>;
}
export interface DatabaseSummary {
  count: number;
  values: Record<string, number | string | null>;
  groups: Array<{
    key: string;
    label: string;
    count: number;
    values: Record<string, number | string | null>;
  }>;
}

export interface CreateDatabasePayload {
  spaceId: string;
  name?: string;
  description?: string;
  descriptionContent?: unknown;
  icon?: string;
  parentPageId?: string;
}

export interface UpdateDatabasePayload {
  name?: string;
  description?: string;
  descriptionContent?: unknown;
  icon?: string;
}

export interface CreateDatabasePropertyPayload {
  name: string;
  type: DatabasePropertyType;
  settings?: DatabasePropertySettings;
}

export interface UpdateDatabasePropertyPayload {
  name?: string;
  type?: DatabasePropertyType;
  position?: number;
  settings?: DatabasePropertySettings;
}

export interface CreateDatabaseRowPayload {
  title?: string;
  icon?: string;
  parentPageId?: string;
}

export interface UpdateDatabaseRowPayload {
  title: string;
}

export interface UpdateDatabaseRowResponse {
  pageId: string;
  title: string;
  slugId: string;
}

export interface DatabaseCellBatchOperation {
  propertyId: string;
  value?: unknown;
  attachmentId?: string;
  operation?: "upsert" | "delete";
  expectedRevision?: number;
}

export interface BatchUpdateDatabaseCellsPayload {
  cells: DatabaseCellBatchOperation[];
}

export interface BatchUpdateDatabaseRowOperation {
  pageId: string;
  operation?: "upsert_cells" | "delete_row";
  cells?: DatabaseCellBatchOperation[];
}

export interface BatchUpdateDatabaseRowsPayload {
  rows: BatchUpdateDatabaseRowOperation[];
}

export interface BatchUpdateDatabaseRowsResponse {
  updatedRows: string[];
  deletedRows: string[];
  failedRows: string[];
  failures?: Array<{
    pageId: string;
    code: "conflict" | "invalid_value" | "forbidden" | "failed";
  }>;
}

export interface CreateDatabaseViewPayload {
  name: string;
  type: string;
  config?: unknown;
}

export interface UpdateDatabaseViewPayload {
  name?: string;
  type?: string;
  config?: unknown;
  expectedRevision?: number;
}

export interface DatabaseExportViewSnapshot {
  viewState?: DatabaseViewState;
  filters?: string;
  sortPropertyId?: string;
  sortDirection?: "asc" | "desc";
  visiblePropertyIds?: string[];
}

export interface ExportDatabasePayload {
  format: DatabaseExportFormat;
  includeChildren?: boolean;
  includeAttachments?: boolean;
  currentView?: DatabaseExportViewSnapshot;
}

export interface DatabaseMarkdownResponse {
  markdown: string;
}
