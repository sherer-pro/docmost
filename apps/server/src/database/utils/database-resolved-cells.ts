import { KyselyDB, KyselyTransaction } from '../types/kysely.types';
import { isDatabaseComputedProperty } from '@docmost/api-contract';
import {
  databasePropertyValue,
  type ComputedDatabaseProperty,
} from './database-computed-value';

// Callers must supply rows already intersected with their current ACL and policy.
export async function resolveComputedDatabaseRows<
  T extends { pageId: string; databaseId?: string; cells?: any[] },
>(
  db: KyselyDB | KyselyTransaction,
  rows: T[],
  properties: ComputedDatabaseProperty[],
  databaseId: string,
  workspaceId: string,
): Promise<T[]> {
  const computed = properties.filter(
    (property) =>
      isDatabaseComputedProperty(property.type) || property.type === 'file',
  );
  if (
    computed.length ||
    rows.some((row) =>
      (row.cells ?? []).some(
        (cell) =>
          Array.isArray(cell.value) &&
          properties.some(
            (property) =>
              property.id === cell.propertyId && property.type === 'user',
          ),
      ),
    )
  )
    computed.push(...properties.filter((property) => property.type === 'user'));
  if (!rows.length || !computed.length) return rows;
  let query: any = db
    .selectFrom('databaseRows')
    .innerJoin('pages', 'pages.id', 'databaseRows.pageId')
    .select('databaseRows.pageId')
    .where('databaseRows.databaseId', '=', databaseId)
    .where('databaseRows.workspaceId', '=', workspaceId)
    .where('pages.workspaceId', '=', workspaceId)
    .where('pages.deletedAt', 'is', null)
    .where('databaseRows.archivedAt', 'is', null)
    .where('databaseRows.pageId', 'in', [
      ...new Set(rows.map((row) => row.pageId)),
    ]);
  for (const [index, property] of computed.entries())
    query = query.select(
      databasePropertyValue(property.id, properties).as(`computed${index}`),
    );
  const values = new Map<string, any>(
    (await query.execute()).map((row: any) => [row.pageId, row]),
  );
  return rows
    .filter((row) => values.has(row.pageId))
    .map((row) => ({
      ...row,
      cells: [
        ...(row.cells ?? []).filter(
          (cell) =>
            !computed.some((property) => property.id === cell.propertyId),
        ),
        ...computed.map((property, index) => ({
          id: property.id,
          pageId: row.pageId,
          databaseId,
          workspaceId,
          propertyId: property.id,
          value: values.get(row.pageId)[`computed${index}`],
          revision: isDatabaseComputedProperty(property.type)
            ? 0
            : ((row.cells ?? []).find((cell) => cell.propertyId === property.id)
                ?.revision ?? 0),
          attachmentId: null,
        })),
      ],
    }));
}
