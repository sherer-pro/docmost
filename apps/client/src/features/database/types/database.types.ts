/**
 * Базовая сущность database из backend API.
 */
export interface IDatabase {
  id: string;
  workspaceId: string;
  spaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  creatorId: string | null;
  lastUpdatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Сущность свойства (колонки) базы данных.
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
 * Сущность строки базы данных.
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
 * Сущность ячейки базы данных.
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
 * Сущность представления базы данных.
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
 * Параметры создания базы данных.
 */
export interface ICreateDatabasePayload {
  spaceId: string;
  name: string;
  description?: string;
  icon?: string;
}

/**
 * Параметры обновления базы данных.
 */
export interface IUpdateDatabasePayload {
  name?: string;
  description?: string;
  icon?: string;
}

/**
 * Параметры создания свойства базы данных.
 */
export interface ICreateDatabasePropertyPayload {
  name: string;
  type: string;
  settings?: unknown;
}

/**
 * Параметры обновления свойства базы данных.
 */
export interface IUpdateDatabasePropertyPayload {
  name?: string;
  type?: string;
  settings?: unknown;
}

/**
 * Параметры создания строки базы данных.
 */
export interface ICreateDatabaseRowPayload {
  title?: string;
  icon?: string;
  parentPageId?: string;
}

/**
 * Операция обновления одной ячейки для batch API.
 */
export interface IDatabaseCellBatchOperation {
  propertyId: string;
  value?: unknown;
  attachmentId?: string;
  operation?: "upsert" | "delete";
}

/**
 * Параметры batch-обновления ячеек строки.
 */
export interface IBatchUpdateDatabaseCellsPayload {
  cells: IDatabaseCellBatchOperation[];
}

/**
 * Параметры создания представления базы данных.
 */
export interface ICreateDatabaseViewPayload {
  name: string;
  type: string;
  config?: unknown;
}

/**
 * Параметры обновления представления базы данных.
 */
export interface IUpdateDatabaseViewPayload {
  name?: string;
  type?: string;
  config?: unknown;
}

/**
 * Ответ batch-обновления ячеек.
 */
export interface IBatchUpdateDatabaseCellsResponse {
  row: IDatabaseRow;
  cells: IDatabaseCell[];
}
