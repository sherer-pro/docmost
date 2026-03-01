import api from "@/lib/api-client";
import {
  IBatchUpdateDatabaseCellsPayload,
  IBatchUpdateDatabaseCellsResponse,
  ICreateDatabasePayload,
  ICreateDatabasePropertyPayload,
  ICreateDatabaseRowPayload,
  ICreateDatabaseViewPayload,
  IDatabase,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  IUpdateDatabasePayload,
  IUpdateDatabasePropertyPayload,
  IUpdateDatabaseViewPayload,
} from "@/features/database/types/database.types";

/**
 * Создаёт базу данных в выбранном пространстве.
 */
export async function createDatabase(
  payload: ICreateDatabasePayload,
): Promise<IDatabase> {
  const req = await api.post<IDatabase>("/databases", payload);
  return req.data;
}

/**
 * Возвращает список баз данных по spaceId.
 */
export async function getDatabases(spaceId: string): Promise<IDatabase[]> {
  const req = await api.get<IDatabase[]>("/databases", {
    params: { spaceId },
  });

  return req.data;
}

/**
 * Возвращает одну базу данных по идентификатору.
 */
export async function getDatabase(databaseId: string): Promise<IDatabase> {
  const req = await api.get<IDatabase>(`/databases/${databaseId}`);
  return req.data;
}

/**
 * Обновляет базу данных.
 */
export async function updateDatabase(
  databaseId: string,
  payload: IUpdateDatabasePayload,
): Promise<IDatabase> {
  const req = await api.patch<IDatabase>(`/databases/${databaseId}`, payload);
  return req.data;
}

/**
 * Мягко удаляет базу данных.
 */
export async function deleteDatabase(databaseId: string): Promise<void> {
  await api.delete(`/databases/${databaseId}`);
}

/**
 * Возвращает список свойств базы данных.
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
 * Создаёт свойство базы данных.
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
 * Обновляет свойство базы данных.
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
 * Мягко удаляет свойство базы данных.
 */
export async function deleteDatabaseProperty(
  databaseId: string,
  propertyId: string,
): Promise<void> {
  await api.delete(`/databases/${databaseId}/properties/${propertyId}`);
}

/**
 * Возвращает строки базы данных.
 */
export async function getDatabaseRows(databaseId: string): Promise<IDatabaseRow[]> {
  const req = await api.get<IDatabaseRow[]>(`/databases/${databaseId}/rows`);
  return req.data;
}

/**
 * Создаёт строку базы данных.
 */
export async function createDatabaseRow(
  databaseId: string,
  payload: ICreateDatabaseRowPayload,
): Promise<IDatabaseRow> {
  const req = await api.post<IDatabaseRow>(`/databases/${databaseId}/rows`, payload);
  return req.data;
}

/**
 * Выполняет batch-обновление ячеек строки.
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
 * Возвращает представления базы данных.
 */
export async function getDatabaseViews(databaseId: string): Promise<IDatabaseView[]> {
  const req = await api.get<IDatabaseView[]>(`/databases/${databaseId}/views`);
  return req.data;
}

/**
 * Создаёт представление базы данных.
 */
export async function createDatabaseView(
  databaseId: string,
  payload: ICreateDatabaseViewPayload,
): Promise<IDatabaseView> {
  const req = await api.post<IDatabaseView>(`/databases/${databaseId}/views`, payload);
  return req.data;
}

/**
 * Обновляет представление базы данных.
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
 * Мягко удаляет представление базы данных.
 */
export async function deleteDatabaseView(
  databaseId: string,
  viewId: string,
): Promise<void> {
  await api.delete(`/databases/${databaseId}/views/${viewId}`);
}
