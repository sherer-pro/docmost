import type { DatabaseViewState } from "./database";

export const AI_DATABASE_LIMITS = {
  rows: 20,
  cells: 100,
  previewBytes: 32768,
} as const;

export interface AiDatabaseContext {
  databaseId: string;
  viewId?: string;
  groupKey?: string;
  viewState: DatabaseViewState;
  selectedPageIds: string[];
}

export interface AiDatabaseCellChange {
  propertyId: string;
  value: unknown;
  expectedRevision: number;
}

export interface AiDatabaseCellRow {
  pageId: string;
  cells: AiDatabaseCellChange[];
}

export interface AiDatabaseCellOperation {
  kind: "databaseCells";
  databaseId: string;
  schemaFingerprint: string;
  rows: AiDatabaseCellRow[];
}

export interface AiDatabaseApprovalPreview {
  kind: "databaseCells";
  databaseId: string;
  pageId: string;
  pageTitle: string;
  beforeText: string;
  afterText: string;
  truncated: false;
  rows: Array<{
    pageId: string;
    title: string;
    cells: Array<
      AiDatabaseCellChange & {
        propertyName: string;
        before: unknown;
        beforeDisplay?: string;
        afterDisplay?: string;
      }
    >;
  }>;
}
