export type RagDocumentType = "page" | "database" | "databaseRow";
export type RagSyncSourceType = "page" | "database_row" | "attachment";

export interface RagPageChange {
  type: "page";
  id: string;
  slugId: string;
  title: string | null;
  updatedAt: string;
  updatedAtMs: number;
}

export interface RagDatabaseChange {
  type: "database";
  id: string;
  databaseId: string;
  slugId: string;
  title: string;
  updatedAt: string;
  updatedAtMs: number;
}

export type RagUpdateItem = RagPageChange | RagDatabaseChange;

export interface RagDeletedItem {
  type: RagDocumentType;
  id: string;
  rowId?: string;
  databaseId?: string;
  slugId?: string | null;
  title?: string | null;
  parentPageId?: string | null;
  deletedAt: string;
  deletedAtMs: number;
}

export interface RagAttachmentItem {
  id: string;
  fileId: string;
  fileName: string;
  fileExt: string;
  mimeType: string | null;
  fileSize: number | string | null;
  pageId: string;
  spaceId: string;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
  downloadUrl: string;
}

export interface RagAttachmentDeletedItem {
  id: string;
  fileId: string;
  pageId: string | null;
  spaceId: string | null;
  deletedAt: string;
  deletedAtMs: number;
}

export interface RagChangeFeed<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  maxUpdatedAtMs?: number;
  maxDeletedAtMs?: number;
}

export interface RagPageDetail {
  id: string;
  slugId: string;
  type: RagDocumentType;
  title: string | null;
  spaceId: string;
  databaseId: string | null;
  updatedAt: string;
  contentMarkdown?: string;
  descriptionMarkdown?: string;
}

export interface RagDatabaseRowDetail {
  id: string;
  pageId: string;
  databaseId: string;
  pageSlugId?: string | null;
  pageTitle?: string | null;
  updatedAt?: string;
  rowMarkdown?: string;
  cells?: Array<{
    propertyId: string;
    value: unknown;
  }>;
  page?: {
    id: string;
    slugId: string;
    title: string | null;
  } | null;
}

export interface RagDatabaseDetail {
  id: string;
  slugId: string;
  databaseId: string;
  type: "database";
  name: string;
  title: string;
  spaceId: string;
  updatedAt?: string;
  knowledgeMarkdown?: string;
  rows: RagDatabaseRowDetail[];
}
