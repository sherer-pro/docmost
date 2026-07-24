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
  | Record<string, never>;

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
}

export interface ExportDatabasePayload {
  format: DatabaseExportFormat;
  includeChildren?: boolean;
  includeAttachments?: boolean;
}

export interface DatabaseMarkdownResponse {
  markdown: string;
}
