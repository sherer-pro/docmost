import api from "@/lib/api-client";
import {
  IBatchUpdateDatabaseCellsPayload,
  IBatchUpdateDatabaseCellsResponse,
  ICreateDatabasePayload,
  ICreateDatabasePropertyPayload,
  ICreateDatabaseRowPayload,
  ICreateDatabaseViewPayload,
  IDatabase,
  IDatabaseMarkdownResponse,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  IUpdateDatabasePayload,
  IExportDatabasePayload,
  IUpdateDatabasePropertyPayload,
  IUpdateDatabaseViewPayload,
} from "@/features/database/types/database.types";
import { saveAs } from "file-saver";
import { IDatabaseRowContext, IDatabaseRowWithCells } from "@/features/database/types/database-table.types";

/**
 * Creates a database in the selected space.
 */
export async function createDatabase(
  payload: ICreateDatabasePayload,
): Promise<IDatabase> {
  const req = await api.post<IDatabase>("/databases", payload);
  return req.data;
}

/**
 * Returns databases by spaceId.
 */
export async function getDatabases(spaceId: string): Promise<IDatabase[]> {
  const req = await api.get<IDatabase[]>("/databases", {
    params: { spaceId },
  });

  return req.data;
}

/**
 * Returns a database by id.
 */
export async function getDatabase(databaseId: string): Promise<IDatabase> {
  const req = await api.get<IDatabase>(`/databases/${databaseId}`);
  return req.data;
}

/**
 * Updates a database.
 */
export async function updateDatabase(
  databaseId: string,
  payload: IUpdateDatabasePayload,
): Promise<IDatabase> {
  const req = await api.patch<IDatabase>(`/databases/${databaseId}`, payload);
  return req.data;
}

/**
 * Soft-deletes a database.
 */
export async function deleteDatabase(databaseId: string): Promise<void> {
  await api.delete(`/databases/${databaseId}`);
}

/**
 * Returns database properties.
 */
export async function getDatabaseProperties(
  databaseId: string,
): Promise<IDatabaseProperty[]> {
  const req = await api.get<IDatabaseProperty[]>(
    `/databases/${databaseId}/properties`,
  );
  return req.data;
}

/**
 * Creates a database property.
 */
export async function createDatabaseProperty(
  databaseId: string,
  payload: ICreateDatabasePropertyPayload,
): Promise<IDatabaseProperty> {
  const req = await api.post<IDatabaseProperty>(
    `/databases/${databaseId}/properties`,
    payload,
  );

  return req.data;
}

/**
 * Updates a database property.
 */
export async function updateDatabaseProperty(
  databaseId: string,
  propertyId: string,
  payload: IUpdateDatabasePropertyPayload,
): Promise<IDatabaseProperty> {
  const req = await api.patch<IDatabaseProperty>(
    `/databases/${databaseId}/properties/${propertyId}`,
    payload,
  );

  return req.data;
}

/**
 * Soft-deletes a database property.
 */
export async function deleteDatabaseProperty(
  databaseId: string,
  propertyId: string,
): Promise<void> {
  await api.delete(`/databases/${databaseId}/properties/${propertyId}`);
}

/**
 * Returns database rows.
 */
export async function getDatabaseRows(
  databaseId: string,
): Promise<IDatabaseRowWithCells[]> {
  const req = await api.get<IDatabaseRowWithCells[]>(`/databases/${databaseId}/rows`);
  return req.data;
}

/**
 * Creates a database row.
 */
export async function createDatabaseRow(
  databaseId: string,
  payload: ICreateDatabaseRowPayload,
): Promise<IDatabaseRow> {
  const req = await api.post<IDatabaseRow>(`/databases/${databaseId}/rows`, payload);
  return req.data;
}

/**
 * Deletes a database row by page id.
 */
export async function deleteDatabaseRow(
  databaseId: string,
  pageId: string,
): Promise<void> {
  await api.delete(`/databases/${databaseId}/rows/${pageId}`);
}

/**
 * Performs batch row cell updates.
 */
export async function batchUpdateDatabaseCells(
  databaseId: string,
  pageId: string,
  payload: IBatchUpdateDatabaseCellsPayload,
): Promise<IBatchUpdateDatabaseCellsResponse> {
  const req = await api.patch<IBatchUpdateDatabaseCellsResponse>(
    `/databases/${databaseId}/rows/${pageId}/cells`,
    payload,
  );

  return req.data;
}

/**
 * Returns database views.
 */
export async function getDatabaseViews(databaseId: string): Promise<IDatabaseView[]> {
  const req = await api.get<IDatabaseView[]>(`/databases/${databaseId}/views`);
  return req.data;
}

/**
 * Creates a database view.
 */
export async function createDatabaseView(
  databaseId: string,
  payload: ICreateDatabaseViewPayload,
): Promise<IDatabaseView> {
  const req = await api.post<IDatabaseView>(`/databases/${databaseId}/views`, payload);
  return req.data;
}

/**
 * Updates a database view.
 */
export async function updateDatabaseView(
  databaseId: string,
  viewId: string,
  payload: IUpdateDatabaseViewPayload,
): Promise<IDatabaseView> {
  const req = await api.patch<IDatabaseView>(
    `/databases/${databaseId}/views/${viewId}`,
    payload,
  );

  return req.data;
}

/**
 * Soft-deletes a database view.
 */
export async function deleteDatabaseView(
  databaseId: string,
  viewId: string,
): Promise<void> {
  await api.delete(`/databases/${databaseId}/views/${viewId}`);
}


/**
 * Returns database row context by page id.
 */
export async function getDatabaseRowContextByPage(
  pageId: string,
): Promise<IDatabaseRowContext | null> {
  const req = await api.get<IDatabaseRowContext | null>(`/databases/rows/${pageId}/context`);
  return req.data;
}


/**
 * Exports a database as markdown/pdf according to backend contract.
 */
export async function exportDatabase(
  databaseId: string,
  payload: IExportDatabasePayload,
): Promise<void> {
  const req = await api.post(`/databases/${databaseId}/export`, payload, {
    responseType: 'blob',
  });

  const fileName = req?.headers['content-disposition']
    ?.split('filename=')[1]
    ?.replace(/"/g, '');

  let decodedFileName = fileName || 'database-export';
  try {
    decodedFileName = decodeURIComponent(decodedFileName);
  } catch {
    // fallback to raw filename
  }

  saveAs(req.data, decodedFileName);
}

/**
 * Returns markdown representation of the current database table.
 */
export async function getDatabaseMarkdown(
  databaseId: string,
): Promise<IDatabaseMarkdownResponse> {
  const req = await api.get<IDatabaseMarkdownResponse>(`/databases/${databaseId}/markdown`);
  return req.data;
}
