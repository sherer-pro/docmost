export const DOCMOST_ARCHIVE_SCHEMA_VERSION = 2 as const;

export type DocmostArchiveScope = "space" | "page" | "database";

export interface DocmostArchiveLegacyPageMetadata {
  pageId: string;
  slugId: string;
  icon: string | null;
  position: string | null;
  parentPath: string | null;
  createdAt: string;
  updatedAt: string;
  headingNumbersMaterialized?: boolean;
}

export interface DocmostArchiveManifestV2 {
  source: "docmost";
  schemaVersion: typeof DOCMOST_ARCHIVE_SCHEMA_VERSION;
  version: string;
  exportedAt: string;
  scope: DocmostArchiveScope;
  displayName: string;
  dataFile: "docmost-data.json";
  pages: Record<string, DocmostArchiveLegacyPageMetadata>;
}

export interface DocmostArchivePage {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  position: string | null;
  parentPageId: string | null;
  content: unknown;
  settings: unknown;
}

export interface DocmostArchiveAttachment {
  id: string;
  pageId: string | null;
  fileName: string;
  fileSize: string | number | null;
  fileExt: string;
  mimeType: string | null;
  type: string | null;
  archivePath: string;
  sha256: string;
}

export interface DocmostArchiveUserReference {
  id: string;
  email: string;
  name: string | null;
}

export interface DocmostArchiveTransclusionSnapshot {
  sourcePageId: string;
  transclusionId: string;
  content: unknown;
}

export interface DocmostArchiveDatabase {
  id: string;
  pageId: string | null;
  name: string;
  description: string | null;
  descriptionContent: unknown;
  icon: string | null;
}

export interface DocmostArchiveDatabaseProperty {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  position: number;
  settings: unknown;
}

export interface DocmostArchiveDatabaseRow {
  id: string;
  databaseId: string;
  pageId: string;
  archived: boolean;
}

export interface DocmostArchiveDatabaseCell {
  id: string;
  databaseId: string;
  pageId: string;
  propertyId: string;
  attachmentId: string | null;
  value: unknown;
}

export interface DocmostArchiveDatabaseView {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: unknown;
}

export interface DocmostArchiveLabel {
  id: string;
  name: string;
  pageIds: string[];
}

export interface DocmostArchiveDictionaryTerm {
  term: string;
  forms: string[];
  definitionMarkdown: string;
}

export interface DocmostPortableSpaceSettings {
  documentFields?: Record<string, boolean>;
  dictionary?: { enabled?: boolean };
  headingNumbering?: { enabled?: boolean };
}

export interface DocmostArchiveDataV2 {
  schemaVersion: typeof DOCMOST_ARCHIVE_SCHEMA_VERSION;
  scope: DocmostArchiveScope;
  sourceSpace: {
    id: string;
    name: string | null;
    settings: DocmostPortableSpaceSettings;
  };
  pages: DocmostArchivePage[];
  attachments: DocmostArchiveAttachment[];
  users: DocmostArchiveUserReference[];
  transclusionSnapshots: DocmostArchiveTransclusionSnapshot[];
  databases: DocmostArchiveDatabase[];
  databaseProperties: DocmostArchiveDatabaseProperty[];
  databaseRows: DocmostArchiveDatabaseRow[];
  databaseCells: DocmostArchiveDatabaseCell[];
  databaseViews: DocmostArchiveDatabaseView[];
  labels: DocmostArchiveLabel[];
  dictionary: DocmostArchiveDictionaryTerm[];
}

export interface ImportPreview {
  fileTaskId: string;
  schemaVersion: number;
  scope: DocmostArchiveScope;
  displayName: string;
  counts: {
    pages: number;
    databases: number;
    rows: number;
    attachments: number;
    dictionaryTerms: number;
    labels: number;
  };
  availableSettings: {
    documentFields: boolean;
    dictionary: boolean;
    headingNumbering: boolean;
  };
  warnings: string[];
}

export interface DocmostImportOptions {
  applyDocumentFields: boolean;
  applyDictionary: boolean;
  applyHeadingNumbering: boolean;
  cleanupLegacyHeadingNumbers?: boolean;
}

export interface ImportReport {
  created: {
    pages: number;
    databases: number;
    rows: number;
    attachments: number;
    labels: number;
    dictionaryTerms: number;
  };
  updated: {
    dictionaryTerms: number;
  };
  skipped: {
    dictionaryTerms: number;
    userReferences: number;
    pageReferences: number;
  };
  warnings: string[];
}
