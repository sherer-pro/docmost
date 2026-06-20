import {
  DatabaseExportFormat,
  type BatchUpdateDatabaseCellsPayload,
  type BatchUpdateDatabaseRowOperation,
  type BatchUpdateDatabaseRowsPayload,
  type BatchUpdateDatabaseRowsResponse,
  type CreateDatabasePayload,
  type CreateDatabasePropertyPayload,
  type CreateDatabaseRowPayload,
  type CreateDatabaseViewPayload,
  type DatabaseCellBatchOperation,
  type DatabaseMarkdownResponse,
  type DatabasePropertySettings,
  type DatabasePropertyType,
  type DatabaseSelectOption,
  type DatabaseSelectPropertySettings,
  type ExportDatabasePayload,
  type UpdateDatabasePayload,
  type UpdateDatabasePropertyPayload,
  type UpdateDatabaseRowPayload,
  type UpdateDatabaseRowResponse,
  type UpdateDatabaseViewPayload,
} from "@docmost/api-contract";
import type {
  IDatabaseFilterCondition,
  IDatabaseSortState,
} from "@/features/database/types/database-table.types";

/**
 * Base database entity from the backend API.
 */
export interface IDatabase {
  id: string;
  workspaceId: string;
  spaceId: string;
  name: string;
  pageId: string | null;
  /**
   * The actual slug of the associated database-page.
   *
   * The field comes from PATCH /databases/:id on rename and is used for
   * instant route update on the client.
   */
  pageSlugId?: string | null;
  description: string | null;
  descriptionContent?: unknown | null;
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
  type: DatabasePropertyType;
  position: number;
  settings: IDatabasePropertySettings;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type IDatabaseSelectOption = DatabaseSelectOption;

export type IDatabaseSelectPropertySettings = DatabaseSelectPropertySettings;

export type IDatabasePropertySettings = DatabasePropertySettings;

/**
 * Database row entity.
 */
export interface IDatabaseRow {
  id: string;
  databaseId: string;
  workspaceId: string;
  pageId: string;
  /**
   * Page slug id for immediate row navigation from sidebar/table without extra refetch.
   */
  slugId?: string | null;
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
  config: IDatabaseViewConfig | null;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface IDatabaseViewConfig {
  visibleColumns?: Record<string, boolean>;
  filters?: IDatabaseFilterCondition[];
  sortState?: IDatabaseSortState | null;
}

/**
 * Database creation payload.
 */
export type ICreateDatabasePayload = CreateDatabasePayload;

/**
 * Database update payload.
 */
export type IUpdateDatabasePayload = UpdateDatabasePayload;

/**
 * Database property creation payload.
 */
export type ICreateDatabasePropertyPayload = CreateDatabasePropertyPayload;

/**
 * Database property update payload.
 */
export type IUpdateDatabasePropertyPayload = UpdateDatabasePropertyPayload;

/**
 * Database row creation payload.
 */
export type ICreateDatabaseRowPayload = CreateDatabaseRowPayload;

/**
 * Database row rename payload.
 */
export type IUpdateDatabaseRowPayload = UpdateDatabaseRowPayload;

/**
 * Database row rename response.
 */
export type IUpdateDatabaseRowResponse = UpdateDatabaseRowResponse;

/**
 * Single-cell update operation for the batch API.
 */
export type IDatabaseCellBatchOperation = DatabaseCellBatchOperation;

/**
 * Row cell batch update payload.
 */
export type IBatchUpdateDatabaseCellsPayload = BatchUpdateDatabaseCellsPayload;

export type IBatchUpdateDatabaseRowOperation = BatchUpdateDatabaseRowOperation;

export type IBatchUpdateDatabaseRowsPayload = BatchUpdateDatabaseRowsPayload;

export type IBatchUpdateDatabaseRowsResponse = BatchUpdateDatabaseRowsResponse;

/**
 * Database view creation payload.
 */
export type ICreateDatabaseViewPayload = CreateDatabaseViewPayload;

/**
 * Database view update payload.
 */
export type IUpdateDatabaseViewPayload = UpdateDatabaseViewPayload;

/**
 * Batch cell update response.
 */
export interface IBatchUpdateDatabaseCellsResponse {
  row: IDatabaseRow;
  cells: IDatabaseCell[];
}

export { DatabaseExportFormat };

export type IExportDatabasePayload = ExportDatabasePayload;

export type IDatabaseMarkdownResponse = DatabaseMarkdownResponse;
