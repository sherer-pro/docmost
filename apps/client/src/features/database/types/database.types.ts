/**
 * Base database entity from the backend API.
 */
export interface IDatabase {
  id: string;
  workspaceId: string;
  spaceId: string;
  name: string;
  pageId: string | null;
  description: string | null;
  icon: string | null;
  /**
   * Optional database status when backend/domain model provides it.
   *
   * Kept optional to preserve backward compatibility while allowing UI
   * to render a status indicator safely when this field is present.
   */
  status?: string | null;
  creatorId: string | null;
  lastUpdatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Database property (column) entity.
 */
export interface IDatabaseProperty {
  id: string;
  databaseId: string;
  workspaceId: string;
  name: string;
  type: string;
  position: number;
  settings: unknown;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Database row entity.
 */
export interface IDatabaseRow {
  id: string;
  databaseId: string;
  workspaceId: string;
  pageId: string;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * Database cell entity.
 */
export interface IDatabaseCell {
  id: string;
  databaseId: string;
  workspaceId: string;
  pageId: string;
  propertyId: string;
  value: unknown;
  attachmentId: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Database view entity.
 */
export interface IDatabaseView {
  id: string;
  databaseId: string;
  workspaceId: string;
  name: string;
  type: string;
  config: unknown;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Database creation payload.
 */
export interface ICreateDatabasePayload {
  spaceId: string;
  name: string;
  description?: string;
  icon?: string;
  parentPageId?: string;
}

/**
 * Database update payload.
 */
export interface IUpdateDatabasePayload {
  name?: string;
  description?: string;
  icon?: string;
}

/**
 * Database property creation payload.
 */
export interface ICreateDatabasePropertyPayload {
  name: string;
  type: string;
  settings?: unknown;
}

/**
 * Database property update payload.
 */
export interface IUpdateDatabasePropertyPayload {
  name?: string;
  type?: string;
  settings?: unknown;
}

/**
 * Database row creation payload.
 */
export interface ICreateDatabaseRowPayload {
  title?: string;
  icon?: string;
  parentPageId?: string;
}

/**
 * Single-cell update operation for the batch API.
 */
export interface IDatabaseCellBatchOperation {
  propertyId: string;
  value?: unknown;
  attachmentId?: string;
  operation?: "upsert" | "delete";
}

/**
 * Row cell batch update payload.
 */
export interface IBatchUpdateDatabaseCellsPayload {
  cells: IDatabaseCellBatchOperation[];
}

/**
 * Database view creation payload.
 */
export interface ICreateDatabaseViewPayload {
  name: string;
  type: string;
  config?: unknown;
}

/**
 * Database view update payload.
 */
export interface IUpdateDatabaseViewPayload {
  name?: string;
  type?: string;
  config?: unknown;
}

/**
 * Batch cell update response.
 */
export interface IBatchUpdateDatabaseCellsResponse {
  row: IDatabaseRow;
  cells: IDatabaseCell[];
}


export enum DatabaseExportFormat {
  Markdown = 'markdown',
  PDF = 'pdf',
}

export interface IExportDatabasePayload {
  format: DatabaseExportFormat;
}

export interface IDatabaseMarkdownResponse {
  markdown: string;
}
