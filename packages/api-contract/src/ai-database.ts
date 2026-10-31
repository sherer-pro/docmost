import type { DatabaseSummary, DatabaseViewState } from "./database";

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

export interface AiDatabaseReadReceipt {
  version: 1;
  mode: "query" | "summary";
  asOf: string;
  schemaFingerprint: string;
  databasePageId: string;
  databaseTitle: string;
  selectedRowCount: number;
  propertyLabels: Record<string, string>;
  calculationDisplays?: Record<string, string>;
}

export interface AiDatabaseResultCard {
  runId: string;
  stepId: string;
  databaseId: string;
  receipt: AiDatabaseReadReceipt;
  viewState: DatabaseViewState;
  groupKey?: string;
  scope: "accessible_ai_allowed_rows";
  summary: DatabaseSummary | null;
  returnedRows: number;
  incomplete: boolean;
  canOpenRows: boolean;
  sourceUrl: string;
  resultUrl: string;
}

export interface AiDatabaseResultRows {
  card: AiDatabaseResultCard;
  asOf: string;
  properties: Array<{
    id: string;
    name: string;
    type: string;
    settings: unknown;
  }>;
  items: Array<{
    pageId: string;
    title: string;
    cells: Array<{ propertyId: string; value: unknown; revision: number }>;
  }>;
  hasMore: boolean;
  nextCursor: string | null;
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
