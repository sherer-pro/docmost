import type { IDatabaseProperty } from "../types/database.types";
import type {
  IDatabaseRowContext,
  IDatabaseRowWithCells,
} from "../types/database-table.types";
import { extractCurrentDatabaseCellValue } from "./database-cell-value";

export interface DatabaseCellConflict {
  key: string;
  row: IDatabaseRowWithCells;
  property: IDatabaseProperty;
  originalValue: unknown;
  draftValue: unknown;
  session: number;
}

export interface DatabaseCellReview {
  property: IDatabaseProperty;
  value: unknown;
  revision: number;
  canWrite: boolean;
  row: IDatabaseRowWithCells;
}

export function isDatabaseCellConflict(error: unknown): boolean {
  return (
    (error as { response?: { status?: number } } | null)?.response?.status ===
    409
  );
}

export function buildDatabaseCellReview({
  databaseId,
  conflict,
  context,
  properties,
  page,
}: {
  databaseId: string;
  conflict: DatabaseCellConflict;
  context: IDatabaseRowContext | null;
  properties: IDatabaseProperty[];
  page: { id: string; access?: { capabilities?: { canWrite?: boolean } } };
}): DatabaseCellReview | null {
  if (
    !context ||
    context.database.id !== databaseId ||
    context.row.databaseId !== databaseId ||
    context.row.pageId !== conflict.row.pageId ||
    page.id !== conflict.row.pageId
  )
    return null;
  const property = properties.find((item) => item.id === conflict.property.id);
  if (
    !property ||
    property.type !== conflict.property.type ||
    property.databaseId !== databaseId ||
    property.deletedAt != null
  )
    return null;
  const cell = context.cells.find((item) => item.propertyId === property.id);
  if (cell && cell.pageId !== conflict.row.pageId) return null;
  return {
    property,
    value: extractCurrentDatabaseCellValue(cell?.value),
    revision: cell?.revision ?? 0,
    canWrite: page.access?.capabilities?.canWrite === true,
    row: {
      ...conflict.row,
      cells: context.cells,
      canWrite: page.access?.capabilities?.canWrite === true,
    },
  };
}
