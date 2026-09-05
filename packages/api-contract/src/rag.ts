export type RagDocumentType = "page" | "database" | "databaseRow";
import type { PageAiRole } from "./page-custom-field";

export type RagSyncSourceType =
  | "page"
  | "database_row"
  | "attachment"
  | "dictionary_term";

export const RAG_KNOWLEDGE_PROJECTION_VERSION = 2 as const;
export const RAG_CONTENT_POLICY_VERSION = 1 as const;

export const RAG_CONTENT_PROCESSOR_IDS = [
  "structured-knowledge-v2",
  "attachment-text-v1",
  "pdf-text-v1",
  "docx-text-v1",
  "image-ocr-v1",
  "image-vision-v1",
  "audio-transcript-v1",
] as const;

export type RagContentProcessorId = (typeof RAG_CONTENT_PROCESSOR_IDS)[number];

export interface RagContentCapability {
  processorId: RagContentProcessorId;
  state: "enabled" | "disabled";
  sourceType: "structured" | "attachment";
  extensions: string[];
  mimeTypes: string[];
}

export interface RagDocumentCustomFields {
  status?: string | null;
  assigneeId?: string | null;
  stakeholderIds?: string[];
  aiRole?: PageAiRole;
}

export interface RagSyncTarget {
  adapter: "open-webui-knowledge-v1";
  baseUrl: string;
  knowledgeId: string;
}

export interface RagScope {
  schemaVersion?: 1 | 2 | 3 | 4;
  projectionVersion: typeof RAG_KNOWLEDGE_PROJECTION_VERSION;
  contentPolicyVersion?: typeof RAG_CONTENT_POLICY_VERSION;
  contentCapabilities?: RagContentCapability[];
  workspaceId: string;
  spaceId: string;
  syncTarget: RagSyncTarget | null;
  fingerprint: string;
  excludedPageIds: string[];
  ragSearchDoneOnly?: boolean;
  statusBlockedPageIds?: string[];
}

export interface RagBlockedPageItem {
  pageId: string;
}

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
  documentEligible: boolean;
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
  /** @deprecated Tombstones no longer expose page metadata. */
  slugId?: string | null;
  /** @deprecated Tombstones no longer expose page metadata. */
  title?: string | null;
  /** @deprecated Tombstones no longer expose page metadata. */
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
  customFields?: RagDocumentCustomFields;
}

export interface RagAttachmentDeletedItem {
  id: string;
  fileId: string;
  /** @deprecated Tombstones no longer expose owning-page metadata. */
  pageId: string | null;
  /** @deprecated Tombstones no longer expose space metadata. */
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
  documentEligible?: boolean;
  title: string | null;
  spaceId: string;
  databaseId: string | null;
  updatedAt: string;
  projectionUpdatedAt?: string;
  customFields?: RagDocumentCustomFields;
  contentMarkdown?: string;
  descriptionMarkdown?: string;
  knowledgeMarkdown?: string;
}

export interface RagDatabaseRowDetail {
  id: string;
  pageId: string;
  databaseId: string;
  pageSlugId?: string | null;
  pageTitle?: string | null;
  updatedAt?: string;
  projectionUpdatedAt?: string;
  rowMarkdown?: string;
  knowledgeMarkdown?: string;
  cells?: Array<{
    propertyId: string;
    propertyName?: string;
    propertyType?: string;
    value: unknown;
  }>;
  page?: {
    id: string;
    slugId: string;
    title: string | null;
    customFields?: RagDocumentCustomFields;
  } | null;
}

export interface RagDatabasePropertyDetail {
  id: string;
  name: string;
  type: string;
  position: number;
  settings: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RagDatabaseDetail {
  id: string;
  slugId: string;
  databaseId: string;
  type: "database";
  documentEligible: boolean;
  name: string;
  title: string;
  spaceId: string;
  updatedAt?: string;
  projectionUpdatedAt?: string;
  customFields?: RagDocumentCustomFields;
  knowledgeMarkdown?: string;
  properties?: RagDatabasePropertyDetail[];
  rows: RagDatabaseRowDetail[];
}

export interface RagDictionaryTermDetail {
  id: string;
  workspaceId: string;
  spaceId: string;
  term: string;
  forms: string[];
  definitionMarkdown: string;
  knowledgeMarkdown: string;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
}

export interface RagDictionaryTermChange {
  type: "dictionaryTerm";
  id: string;
  term: string;
  updatedAt: string;
  updatedAtMs: number;
}

export interface RagDictionaryTermDeletedItem {
  type: "dictionaryTerm";
  id: string;
  deletedAt: string;
  deletedAtMs: number;
}
